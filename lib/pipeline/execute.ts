import { assertReferenceOnlyPlan } from "../ground-context/server";
import { checkRunReferences } from "../ground-context/check-run";
import { enrichWithReferences, reviewGrounding } from "../ground-context/operations";
import type { GroundContextSnapshot, GroundingReport } from "../ground-context/types";
import type { MetadataValues, MetadataDecision } from "../metadata/settings";
import type { MetadataReport } from "../metadata/types";
import { db } from "../db";
import { getRun } from "../db/runs";
import { orderedSources } from "../ks/source-document";
import { withSourceContext } from "../llm/source-context";
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
import { validateFields, validateSummary } from "./content";
import { getWriteState, saveWriteState } from "./state";
import type { ReviewObjective } from "../ks/solution-reviews";
import { applicableDirectives, type ScopedDirective } from "../demand/spec";
import { assessDemandCompliance, validateDemandCompliance, type DemandCompliance } from "../demand/compliance";
import type { AuthoringSnippet } from "../llm/operations";

export interface PreparedContent {
  groundContext?: GroundContextSnapshot;
  grounding?: GroundingReport;
  groundingEnriched?: boolean;
  metadata?: MetadataValues;
  metadataResearch?: MetadataReport;
  metadataDecisions?: Record<string, MetadataDecision>;
  metadataEvidenceChanged?: boolean;
  version: string;
  readyForSubmission?: boolean;
  sourceVersions?: Record<string, string>;
  sourceDocuments?: { id: string; title: string; templateName: string; body: string }[];
  title: string;
  summary: string;
  keywords: string[];
  templateName: string;
  fields: WSDisplayField[];
  sections?: MergeWorkspaceResult["sections"];
  warnings: string[];
  ruleResults?: StandardsResult["ruleResults"];
  /** IDs of reusable HTML structures made available during authoring. */
  snippetIds?: string[];
  demandCompliance?: DemandCompliance;
  reviewed?: boolean;
  standardsApplied?: boolean;
}
export interface ContentReview {
  title?: string;
  summary?: string;
  keywords?: string[];
  regenerate?: boolean;
  templateName?: string;
  version: string;
  fields: WSDisplayField[];
}
export interface ExecuteArgs {
  stage?: "preparation" | "submission";
  reviewIdentity?: string;
  prepareOnly?: boolean;
  requirePrepared?: boolean;
  approvals?: Record<string, string>;
  runId: string;
  user: string;
  plan: WriteOp[];
  collection: string;
  language: string;
  restructureEnabled?: boolean;
  standardsRules?: string[];
  /** Frozen standards resolved against each output's final metadata. */
  standardRulesByCandidate?: Record<string, string[]>;
  /** Frozen reusable HTML structures, scoped to each final article. */
  snippetsByCandidate?: Record<string, AuthoringSnippet[]>;
  /** Server-bound review findings that must shape the draft, never authorize a write. */
  reviewObjectives?: ReviewObjective[];
  /** Unified demand and review guidance, already bound to the saved run. */
  directives?: ScopedDirective[];
  reviews?: Record<string, ContentReview>;
}
export interface OpResult {
  idempotencyKey: string;
  kind: WriteOp["kind"];
  description: string;
  outcome: "ok" | "error" | "skipped" | "review" | "uncertain" | "ready";
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
  result?: OpResult;
}

/** Check every remaining article before the first possible write. */
export async function assertPreparedPlan(args: ExecuteArgs) {
  if (args.reviews && Object.keys(args.reviews).length) throw new Error("Save draft edits with Prepare drafts before submitting.");
  for (const op of args.plan) {
    if (op.kind === "flag") continue;
    const state = await getWriteState(op.idempotencyKey);
    if (state?.status === "ok" || await alreadySucceeded(op.idempotencyKey)) continue;
    if (!state?.prepared?.readyForSubmission || args.approvals?.[op.idempotencyKey] !== state.prepared.version) {
      throw new Error("Prepare and review every draft before submitting. A draft is missing, unresolved, or has changed.");
    }
  }
}

/** Caller holds a durable run lock. Each write is journaled before contacting RA. */
export async function executeWritePlan(args: ExecuteArgs, onProgress?: (p: ExecuteProgress) => void): Promise<OpResult[]> {
  const run = await getRun(args.runId);
  if (run && run.author !== args.user) throw new Error("Run belongs to another author");
  assertReferenceOnlyPlan(args.plan, run?.groundContext);
  onProgress?.({ index: 0, total: args.plan.length, description: "Checking selected reference versions and access…" });
  if (run) await checkRunReferences(run, args.user);
  if (run?.groundContext?.selection.enabled && !args.prepareOnly && !args.requirePrepared) throw new Error("Prepare and review grounded drafts before submitting.");
  const originals = run?.content || run?.attachments?.some(a => a.imageId || a.fileId) ? orderedSources({ text: run.inputText, attachments: run.attachments, content: run.content }) : [];
  return withSourceContext(originals, () => executeWritePlanImpl(args, onProgress, run?.groundContext));
}
async function executeWritePlanImpl(args: ExecuteArgs, onProgress?: (p: ExecuteProgress) => void, groundContext?: GroundContextSnapshot): Promise<OpResult[]> {
  const { runId, user, plan, collection, language, restructureEnabled, standardsRules = [], standardRulesByCandidate = {}, snippetsByCandidate = {}, directives = [] } = args;
  if (args.requirePrepared && !args.prepareOnly) await assertPreparedPlan(args);
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
    const snippets = op.kind === "flag" ? [] : snippetsByCandidate[op.candidateKey] ?? [];
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
        const generated = await restructure([{ label: "saved source content", content: op.rawContent }], target, op.proposal, !restructureEnabled, applicableDirectives(directives, "author"), snippets);
        prepared = { version: randomUUID(), title: op.titleLocked ? op.title : generated.data.title, summary: generated.data.summary, keywords: [...new Set([...(op.keywords ?? []), ...generated.data.keywords])], templateName: target.templateName, fields: generated.data.fields, warnings: [], ...(snippets.length ? { snippetIds: snippets.map(snippet => snippet.id) } : {}) };
        if (groundContext?.selection.enabled) {
          prepared.groundContext = groundContext;
          const enriched = await enrichWithReferences(prepared, groundContext);
          prepared = { ...prepared, title: op.titleLocked ? op.title : enriched.data.title, summary: enriched.data.summary, keywords: enriched.data.keywords, fields: enriched.data.fields, groundContext, groundingEnriched: true, grounding: { evidence: enriched.data.evidence, issues: enriched.data.issues } };
          prepared.sourceDocuments = [{ id: op.candidateKey, title: op.title, templateName: target.templateName, body: op.rawContent }];
        }
        try { prepared.fields = validateFields(prepared.fields, target); } catch (e) { prepared.warnings.push((e as Error).message); }
        result = { ...base, outcome: "review", prepared, message: "Regenerated from saved sources. Review the fields below, then submit. No write has occurred for this item." };
      } else if (op.kind === "flag" && args.prepareOnly) {
        result = { ...base, outcome: "skipped", message: "Planned tracking comment; waits for a successful merge submission." };
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
          if (args.requirePrepared && !args.prepareOnly) throw new Error("Prepare this draft before submitting.");
          prepared = { version: randomUUID(), title: op.title, summary: op.summary ?? "", keywords: op.keywords ?? [], templateName: op.templateName ?? "", fields: op.fields ?? [], warnings: [], ...(groundContext?.selection.enabled ? { groundContext } : {}), ...(snippets.length ? { snippetIds: snippets.map(snippet => snippet.id) } : {}) };
          if (op.mergeSources?.length) {
            const merged = await mergeGroupFields({ survivorId: op.kind === "revise" ? op.solutionId : op.candidateKey, survivorTitle: op.title, survivorTemplateName: op.templateName, survivorFields: op.fields, survivorRawContent: op.rawContent, proposal: op.proposal, sources: op.mergeSources, user, survivorEdited: op.edited, sourceVersion: op.sourceVersion, directives: applicableDirectives(directives, "merge"), snippets });
            prepared.fields = merged.fields;
            prepared.title = op.titleLocked ? op.title : merged.title ?? op.title;
            prepared.summary = merged.summary ?? prepared.summary;
            prepared.keywords = [...new Set([...prepared.keywords, ...(merged.keywords ?? [])])];
            prepared.templateName = merged.templateName ?? prepared.templateName;
            prepared.sections = merged.sections;
            prepared.sourceVersions = merged.sourceVersions;
            prepared.sourceDocuments = merged.sourceDocuments;
            if (merged.templateWarning) prepared.warnings.push(merged.templateWarning);
          } else if ((op.kind === "create" || restructureEnabled) && op.rawContent) {
            onProgress?.({ index, total: plan.length, description: `Generating draft: ${op.title}` });
            const target = templates.find((t) => t.templateName === op.templateName);
            if (!target) throw new Error("Final template is unavailable; choose a valid template in a new run.");
            const r = await restructure([{ label: "source content", content: op.rawContent }], target, op.proposal, !restructureEnabled, applicableDirectives(directives, "author"), snippets);
            prepared.fields = r.data.fields;
            prepared.title = op.titleLocked ? op.title : r.data.title;
            prepared.summary = r.data.summary;
            prepared.keywords = [...new Set([...(op.keywords ?? []), ...r.data.keywords])];
          }
          prepared.sourceDocuments ??= [{ id: op.kind === "revise" ? op.solutionId : op.candidateKey, title: op.title, templateName: op.templateName ?? "", body: op.rawContent ?? (op.fields ?? []).map((f) => `${f.fieldName}\n${f.fieldValue}`).join("\n\n") }];
          (await saveWriteState(runId, op.idempotencyKey, { status: "prepared", prepared }));
        }
        if (groundContext?.selection.enabled && !prepared.groundingEnriched) {
          prepared.groundContext = groundContext;
          onProgress?.({ index, total: plan.length, description: `Applying reference information: ${op.title}` });
          const enriched = await enrichWithReferences(prepared, groundContext);
          prepared = { ...prepared, title: op.titleLocked ? op.title : enriched.data.title, summary: enriched.data.summary, keywords: enriched.data.keywords, fields: enriched.data.fields, groundContext, grounding: { evidence: enriched.data.evidence, issues: enriched.data.issues }, groundingEnriched: true, readyForSubmission: false };
        }
        const review = args.reviews?.[op.idempotencyKey];
        if (review) {
          if (review.version !== prepared.version) throw new Error("Review is stale. Reload the current prepared content.");
          prepared = { ...prepared, version: randomUUID(), title: review.title ?? prepared.title, summary: review.summary ?? prepared.summary, keywords: review.keywords ?? prepared.keywords, fields: review.fields, reviewed: true, standardsApplied: false, readyForSubmission: false, grounding: undefined };
        }
        prepared.metadata = op.metadata;
        if (args.prepareOnly) {
          const savedResearch = await db().prepare("SELECT report FROM metadata_research WHERE run_id=? AND candidate_key=?").get(runId, op.candidateKey) as { report: string } | undefined;
          prepared.metadataResearch = savedResearch ? JSON.parse(savedResearch.report) : undefined;
          prepared.metadataDecisions = (await getRun(runId))?.snapshot?.metadata?.decisions?.[op.candidateKey];
        }
        const target = templates.find((t) => t.templateName === prepared!.templateName);
        if (!target) throw new Error("The prepared template is no longer available.");
        if (!prepared.reviewed && prepared.sections?.some((s) => s.conflict.present)) {
          result = { ...base, outcome: "review", prepared, message: "Resolve the conflicting claims below. No write has occurred for this article." };
        } else {
          try {
            validateSummary(prepared.summary);
            prepared.fields = validateFields(prepared.fields, target);
            const applicableStandards = standardRulesByCandidate[op.candidateKey] ?? standardsRules;
            if (applicableStandards.length && !prepared.standardsApplied) {
              if (args.requirePrepared && !args.prepareOnly) throw new Error("Prepare standards changes before submitting.");
              const standards = await applyStandards(prepared.fields, applicableStandards, applicableDirectives(directives, "standards"), snippets);
              prepared.fields = validateFields(standards.data.fields, target);
              prepared.ruleResults = standards.data.ruleResults;
              prepared.standardsApplied = true;
            }
          } catch (e) {
            const unknown = prepared.fields.filter((f) => !target.fields.some((t) => t.fieldName === f.fieldName));
            if (unknown.length) prepared.warnings.push(`Unmapped content requires placement: ${unknown.map((f) => `${f.fieldName}: ${f.fieldValue}`).join("\n")}`);
            prepared.fields = target.fields.map((f) => ({ fieldName: f.fieldName, fieldValue: prepared!.fields.find((v) => v.fieldName === f.fieldName)?.fieldValue ?? "" }));
            prepared.readyForSubmission = false;
            const reviewResult: OpResult = { ...base, outcome: "review", prepared, message: (e as Error).message };
            (await saveWriteState(runId, op.idempotencyKey, { status: "review", prepared, result: reviewResult }));
            results.push(reviewResult);
            onProgress?.({ index, total: plan.length, description, outcome: "review", result: reviewResult });
            continue;
          }
          if (groundContext?.selection.enabled && (args.prepareOnly || !prepared.grounding)) {
            onProgress?.({ index, total: plan.length, description: `Verifying exact reference excerpts: ${op.title}` });
            prepared.groundContext = groundContext;
            prepared.grounding = await reviewGrounding(prepared, groundContext);
            if (prepared.grounding.issues.length) {
              prepared.readyForSubmission = false;
              const reviewResult: OpResult = { ...base, outcome: "review", prepared, message: "Resolve Ground Context issues in the article, then save and validate the draft." };
              await saveWriteState(runId, op.idempotencyKey, { status: "review", prepared, result: reviewResult });
              results.push(reviewResult);
              onProgress?.({ index, total: plan.length, description, outcome: "review", result: reviewResult });
              continue;
            }
          }
          if (groundContext?.selection.enabled && (!prepared.grounding || prepared.grounding.issues.length)) throw new Error("Ground Context review is incomplete. Prepare the draft again.");
          for (const [id, version] of Object.entries(prepared.sourceVersions ?? {})) {
            if (solutionVersion(await ra.getSolution(id, ctx)) !== version) throw new Error(`Source ${id} changed after preparation. Start a new analysis to include its current content.`);
          }
          if (op.kind === "revise" && args.prepareOnly) {
            const parent = await ra.getSolution(op.solutionId, ctx);
            const version = solutionVersion(parent);
            if (op.sourceVersion && !op.mergeSources?.length && version !== op.sourceVersion) throw new Error("Source changed since analysis. Analyze the latest content before updating.");
            if (parent.templateName !== prepared.templateName) throw new Error("Source template changed; analyze it again before writing.");
            prepared.sourceVersions = { ...prepared.sourceVersions, [parent.id]: version };
          }
          if (!prepared.title.trim()) throw new Error("Article title must not be empty.");
          prepared.metadata = op.metadata;
          if (args.prepareOnly) {
            const normalizeText = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").toLowerCase();
            const finalText = normalizeText([prepared.title, prepared.summary, ...prepared.fields.map(f => f.fieldValue)].join(" "));
            const researchIdentity = prepared.metadataResearch?.identity;
            prepared.metadataEvidenceChanged = (!!prepared.metadataResearch && prepared.metadataResearch.planSourceKey !== JSON.stringify({ ...op, metadata: undefined })) || Object.values(prepared.metadataDecisions ?? {}).some(d => d.status === "accepted" && d.kind !== "attribute" && (!finalText.includes(normalizeText(d.sourceEvidence)) || d.researchIdentity !== researchIdentity));
          }
          const qualityDirectives = applicableDirectives(directives, "quality");
          if (args.prepareOnly && qualityDirectives.length) {
            onProgress?.({ index, total: plan.length, description: `Checking demand requirements: ${prepared.title}` });
            const assessment = await assessDemandCompliance(prepared, qualityDirectives);
            validateDemandCompliance(assessment.data, prepared, qualityDirectives);
            prepared.demandCompliance = assessment.data;
            const blockers = assessment.data.checks.filter((check) => qualityDirectives.find((directive) => directive.id === check.directiveId)?.priority === "required" && check.verdict !== "met");
            if (blockers.length) {
              prepared.readyForSubmission = false;
              const reviewResult: OpResult = { ...base, outcome: "review", prepared, message: "Resolve the required demand requirement checks below, then save and validate the draft." };
              await saveWriteState(runId, op.idempotencyKey, { status: "review", prepared, result: reviewResult });
              results.push(reviewResult);
              onProgress?.({ index, total: plan.length, description, outcome: "review", result: reviewResult });
              continue;
            }
          }
          prepared.readyForSubmission = true;
          (await saveWriteState(runId, op.idempotencyKey, { status: "prepared", prepared }));
          if (args.prepareOnly) {
            result = { ...base, outcome: "ready", title: prepared.title, fields: prepared.fields, prepared, message: "Draft prepared for your review. No RightAnswers write has occurred." };
            await saveWriteState(runId, op.idempotencyKey, { status: "prepared", prepared, result });
            results.push(result);
            onProgress?.({ index, total: plan.length, description, outcome: "ready", result });
            continue;
          }
          const changes = { title: prepared.title, summary: prepared.summary, keywords: prepared.keywords.join(","), fields: prepared.fields };
          let solutionId: string;
          let response: string;
          if (op.kind === "create") {
            payload = { ...changes, templateName: prepared.templateName, status: "review", collections: op.metadata?.collections?.join(",") ?? collection, taxonomies: op.metadata?.taxonomies?.join(","), language: op.metadata?.language ?? language };
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
            const updated = await ra.updateSolution(parent, { ...changes, ...(op.metadata?.collections ? { collections: op.metadata.collections.join(",") } : {}), ...(op.metadata?.taxonomies ? { taxonomies: op.metadata.taxonomies.join(",") } : {}), ...(op.metadata?.language ? { language: op.metadata.language } : {}) }, ctx);
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
      if (!writing && prepared) prepared.readyForSubmission = false;
      result = { ...base, outcome: uncertain ? "uncertain" : "error", prepared, message: (err as Error).message };
      (await recordAudit({ ts: new Date().toISOString(), runId, user, op: op.kind, idempotencyKey: op.idempotencyKey, request: payload, outcome: "error", error: result.message }));
    }
    state = { status: result.outcome === "skipped" ? "error" : result.outcome === "ready" ? "prepared" : result.outcome, prepared, result };
    (await saveWriteState(runId, op.idempotencyKey, state));
    results.push(result);
    onProgress?.({ index, total: plan.length, description, outcome: result.outcome, result });
  }
  return results;
}
