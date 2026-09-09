import { solutionVersion } from "./version";
import { randomUUID } from "node:crypto";
import { ra } from "../ra/client";
import type { WSDisplayField } from "../ra/types";
import { applyStandards, restructure, type MergeWorkspaceResult, type StandardsResult } from "../llm/operations";
import { pendingRevisionId } from "../ra/parse";
import { RaError } from "../ra/http";
import { alreadySucceeded, recordAudit } from "./audit";
import { mergeGroupFields } from "./merge";
import { describeOp, type WriteOp } from "./submit";
import { validateFields } from "./content";
import { getWriteState, saveWriteState } from "./state";

export interface PreparedContent {
  version: string;
  sourceVersions?: Record<string, string>;
  title: string;
  summary: string;
  keywords: string[];
  templateName: string;
  fields: WSDisplayField[];
  sections?: MergeWorkspaceResult["sections"];
  warnings: string[];
  ruleResults?: StandardsResult["ruleResults"];
  reviewed?: boolean;
  standardsApplied?: boolean;
}
export interface ContentReview {
  regenerate?: boolean;
  templateName?: string;
  version: string;
  fields: WSDisplayField[];
}
export interface ExecuteArgs {
  runId: string;
  user: string;
  plan: WriteOp[];
  collection: string;
  language: string;
  restructureEnabled?: boolean;
  standardsRules?: string[];
  reviews?: Record<string, ContentReview>;
}
export interface OpResult {
  idempotencyKey: string;
  kind: WriteOp["kind"];
  description: string;
  outcome: "ok" | "error" | "skipped" | "review" | "uncertain";
  solutionId?: string;
  message?: string;
  fields?: WSDisplayField[];
  title?: string;
  prepared?: PreparedContent;
}
export interface ExecuteProgress {
  index: number;
  total: number;
  description: string;
  outcome?: OpResult["outcome"];
}

/** Caller holds a durable run lock. Each write is journaled before contacting RA. */
export async function executeWritePlan(args: ExecuteArgs, onProgress?: (p: ExecuteProgress) => void): Promise<OpResult[]> {
  const { runId, user, plan, collection, language, restructureEnabled, standardsRules = [] } = args;
  const results: OpResult[] = [];
  const ctx = { impUser: user };
  const templates = await ra.getTemplates(ctx);
  const regenerationOnly = Object.values(args.reviews ?? {}).some((r) => r.regenerate);
  for (const [index, op] of plan.entries()) {
    const description = describeOp(op);
    const base = { idempotencyKey: op.idempotencyKey, kind: op.kind, description };
    onProgress?.({ index, total: plan.length, description });
    let state = (await getWriteState(op.idempotencyKey));
    const prior = (await alreadySucceeded(op.idempotencyKey));
    let prepared = state?.prepared;
    let writing = false;
    let result: OpResult;
    let payload: unknown = op;
    try {
      if (state?.status === "ok" || prior) {
        result = state?.result ?? { ...base, outcome: "ok", solutionId: prior?.target ?? undefined, message: "Completed in an earlier attempt" };
      } else if (state?.status === "writing" || state?.status === "uncertain") {
        result = { ...base, outcome: "uncertain", prepared, message: "The previous write may have reached RightAnswers. Verify its result before any retry." };
      } else if (regenerationOnly && !args.reviews?.[op.idempotencyKey]?.regenerate) {
        result = state?.result ?? { ...base, outcome: "skipped", message: "No write attempted while regenerating a review item" };
      } else if (args.reviews?.[op.idempotencyKey]?.regenerate) {
        const review = args.reviews[op.idempotencyKey];
        if (state?.status !== "review" || !prepared || review.version !== prepared.version) throw new Error("Review is stale. Reload before regenerating.");
        if (op.kind !== "create" || op.mergeSources?.length || !op.rawContent) throw new Error("Regeneration is available for unwritten new articles with saved source content.");
        const target = templates.find((t) => t.templateName === (review.templateName ?? prepared!.templateName));
        if (!target) throw new Error("Choose an available template.");
        const generated = await restructure([{ label: "saved source content", content: op.rawContent }], target, op.proposal, !restructureEnabled);
        prepared = { version: randomUUID(), title: op.titleLocked ? op.title : generated.data.title, summary: generated.data.summary, keywords: [...new Set([...(op.keywords ?? []), ...generated.data.keywords])], templateName: target.templateName, fields: generated.data.fields, warnings: [] };
        try { prepared.fields = validateFields(prepared.fields, target); } catch (e) { prepared.warnings.push((e as Error).message); }
        result = { ...base, outcome: "review", prepared, message: "Regenerated from saved sources. Review the fields below, then submit. No write has occurred for this item." };
      } else if (op.kind === "flag") {
        const survivor = plan.find((p) => p.kind !== "flag" && p.candidateKey === op.survivorKey);
        const landed = survivor ? results.find((r) => r.idempotencyKey === survivor.idempotencyKey && r.outcome === "ok") : undefined;
        if (!landed?.solutionId) {
          result = { ...base, outcome: "skipped", message: "Waiting for this group's survivor write to succeed" };
        } else {
          const survivorId = survivor?.kind === "revise" ? survivor.solutionId : landed.solutionId;
          const survivorTitle = landed.title ?? (survivor && survivor.kind !== "flag" ? survivor.title : op.survivorLabel);
          payload = { loserId: op.solutionId, survivor: { id: survivorId, title: survivorTitle } };
          (await saveWriteState(runId, op.idempotencyKey, { status: "writing" }));
          writing = true;
          const response = await ra.flagMergedInto(op.solutionId, { id: survivorId, title: survivorTitle }, ctx);
          result = { ...base, outcome: "ok", solutionId: op.solutionId };
          (await recordAudit({ ts: new Date().toISOString(), runId, user, op: op.kind, idempotencyKey: op.idempotencyKey, target: op.solutionId, request: payload, outcome: "ok", response }));
        }
      } else {
        if (!prepared) {
          prepared = { version: randomUUID(), title: op.title, summary: op.summary ?? "", keywords: op.keywords ?? [], templateName: op.templateName ?? "", fields: op.fields ?? [], warnings: [] };
          if (op.mergeSources?.length) {
            const merged = await mergeGroupFields({ survivorId: op.kind === "revise" ? op.solutionId : op.candidateKey, survivorTitle: op.title, survivorTemplateName: op.templateName, survivorFields: op.fields, survivorRawContent: op.rawContent, proposal: op.proposal, sources: op.mergeSources, user, survivorEdited: op.edited, sourceVersion: op.sourceVersion });
            prepared.fields = merged.fields;
            prepared.title = op.titleLocked ? op.title : merged.title ?? op.title;
            prepared.summary = merged.summary ?? prepared.summary;
            prepared.keywords = [...new Set([...prepared.keywords, ...(merged.keywords ?? [])])];
            prepared.templateName = merged.templateName ?? prepared.templateName;
            prepared.sections = merged.sections;
            prepared.sourceVersions = merged.sourceVersions;
            if (merged.templateWarning) prepared.warnings.push(merged.templateWarning);
          } else if ((op.kind === "create" || restructureEnabled) && op.rawContent) {
            const target = templates.find((t) => t.templateName === op.templateName);
            if (!target) throw new Error("Final template is unavailable; choose a valid template in a new run.");
            const r = await restructure([{ label: "source content", content: op.rawContent }], target, op.proposal, !restructureEnabled);
            prepared.fields = r.data.fields;
            prepared.title = op.titleLocked ? op.title : r.data.title;
            prepared.summary = r.data.summary;
            prepared.keywords = [...new Set([...(op.keywords ?? []), ...r.data.keywords])];
          }
          (await saveWriteState(runId, op.idempotencyKey, { status: "prepared", prepared }));
        }
        const review = args.reviews?.[op.idempotencyKey];
        if (review) {
          if (review.version !== prepared.version) throw new Error("Review is stale. Reload the current prepared content.");
          prepared = { ...prepared, fields: review.fields, reviewed: true, standardsApplied: false };
        }
        const target = templates.find((t) => t.templateName === prepared!.templateName);
        if (!target) throw new Error("The prepared template is no longer available.");
        if (!prepared.reviewed && prepared.sections?.some((s) => s.conflict.present)) {
          result = { ...base, outcome: "review", prepared, message: "Resolve the conflicting claims below. No write has occurred for this article." };
        } else {
          try {
            prepared.fields = validateFields(prepared.fields, target);
            if (standardsRules.length && !prepared.standardsApplied) {
              const standards = await applyStandards(prepared.fields, standardsRules);
              prepared.fields = validateFields(standards.data.fields, target);
              prepared.ruleResults = standards.data.ruleResults;
              prepared.standardsApplied = true;
            }
          } catch (e) {
            const unknown = prepared.fields.filter((f) => !target.fields.some((t) => t.fieldName === f.fieldName));
            if (unknown.length) prepared.warnings.push(`Unmapped content requires placement: ${unknown.map((f) => `${f.fieldName}: ${f.fieldValue}`).join("\n")}`);
            prepared.fields = target.fields.map((f) => ({ fieldName: f.fieldName, fieldValue: prepared!.fields.find((v) => v.fieldName === f.fieldName)?.fieldValue ?? "" }));
            const reviewResult: OpResult = { ...base, outcome: "review", prepared, message: (e as Error).message };
            (await saveWriteState(runId, op.idempotencyKey, { status: "review", prepared, result: reviewResult }));
            results.push(reviewResult);
            onProgress?.({ index, total: plan.length, description, outcome: "review" });
            continue;
          }
          for (const [id, version] of Object.entries(prepared.sourceVersions ?? {})) {
            if (solutionVersion(await ra.getSolution(id, ctx)) !== version) throw new Error(`Source ${id} changed after preparation. Start a new analysis to include its current content.`);
          }
          if (!prepared.title.trim()) throw new Error("Article title must not be empty.");
          (await saveWriteState(runId, op.idempotencyKey, { status: "prepared", prepared }));
          const changes = { title: prepared.title, summary: prepared.summary, keywords: prepared.keywords.join(","), fields: prepared.fields };
          let solutionId: string;
          let response: string;
          if (op.kind === "create") {
            payload = { ...changes, templateName: prepared.templateName, status: "review", collections: collection, language };
            (await saveWriteState(runId, op.idempotencyKey, { status: "writing", prepared }));
            writing = true;
            response = await ra.manageSolution(payload as Parameters<typeof ra.manageSolution>[0], ctx);
            solutionId = response.match(/\b\d{15}\b/)?.[0] ?? "";
            if (!solutionId) throw new Error("Write response did not identify the created solution; reconcile before retrying.");
          } else {
            const parent = await ra.getSolution(op.solutionId, ctx);
            if (op.sourceVersion && !op.mergeSources?.length && solutionVersion(parent) !== op.sourceVersion) throw new Error("Source changed since analysis. Analyze the latest content before updating.");
            if (parent.templateName !== prepared.templateName) throw new Error("Source template changed; analyze it again before writing.");
            const pending = pendingRevisionId(parent.revisionID);
            // Do not overwrite someone else's pending editorial work.
            if (pending) throw new Error(`Article has pending revision ${pending}. Review it in RightAnswers before starting a new update.`);
            payload = { ...changes, templateName: parent.templateName, parentId: parent.id, sourceStatus: parent.status, collections: parent.collections, taxonomy: parent.taxonomy, language: parent.language };
            (await saveWriteState(runId, op.idempotencyKey, { status: "writing", prepared }));
            writing = true;
            const updated = await ra.updateSolution(parent, changes, ctx);
            payload = updated.request;
            solutionId = updated.solutionId;
            if (!solutionId) throw new Error("Missing write target; reconcile before retrying.");
            response = `${updated.mode} -> ${solutionId}`;
          }
          result = { ...base, outcome: "ok", solutionId, title: prepared.title, fields: prepared.fields, prepared };
          (await recordAudit({ ts: new Date().toISOString(), runId, user, op: op.kind, idempotencyKey: op.idempotencyKey, target: solutionId, request: payload, outcome: "ok", response }));
        }
      }
    } catch (err) {
      const definiteRejection = err instanceof RaError && ((err.status >= 400 && err.status < 500) || (err.status === 200 && err.message.startsWith("manageSolution rejected")));
      const uncertain = writing && !definiteRejection;
      result = { ...base, outcome: uncertain ? "uncertain" : "error", prepared, message: (err as Error).message };
      (await recordAudit({ ts: new Date().toISOString(), runId, user, op: op.kind, idempotencyKey: op.idempotencyKey, request: payload, outcome: "error", error: result.message }));
    }
    state = { status: result.outcome === "skipped" ? "error" : result.outcome, prepared, result };
    (await saveWriteState(runId, op.idempotencyKey, state));
    results.push(result);
    onProgress?.({ index, total: plan.length, description, outcome: result.outcome });
  }
  return results;
}
