import type { WriteOp } from "../pipeline/submit";
import type { OpResult } from "../pipeline/execute";
import type { ViewCandidate, ViewDupeGroup } from "./model";

export interface GraphSource {
  id: string; title: string; existing: boolean; retained: boolean;
  body?: string; templateName?: string; labels?: string[];
}
export interface SubmissionRow {
  key: string; title: string; kind: "create" | "revise"; merge: boolean;
  destinationId?: string; templateName?: string; sources: GraphSource[];
  similarity?: number;
  reason: string; coverage: string[]; questions: string[];
  preparation: { label: string; prompt?: string }[];
  result?: OpResult; comments: { key: string; sourceId: string; title: string; result?: OpResult }[];
}
export interface SubmissionGraphModel { rows: SubmissionRow[]; counts: { created: number; revised: number; merged: number; comments: number } }

/** A projection of the real write plan, never of proposal badges or assumed survivors. */
export function buildSubmissionGraph(plan: WriteOp[], candidates: ViewCandidate[] = [], results: OpResult[] = [], options: { restructureEnabled?: boolean; standardsRules?: string[]; groups?: ViewDupeGroup[] } = {}): SubmissionGraphModel {
  const rows: SubmissionRow[] = plan.filter((op) => op.kind !== "flag").map((op) => {
    const candidate = candidates.find((c) => c.key === op.candidateKey);
    const merge = !!op.mergeSources?.length;
    const sources = [{ id: op.kind === "revise" ? op.solutionId : op.candidateKey, title: op.title, templateName: op.templateName, rawContent: op.rawContent }, ...(op.mergeSources ?? [])].map((s, i) => ({
      id: s.id, title: s.title, existing: /^\d{15}$/.test(s.id), retained: i === 0,
      body: results.find((r) => r.idempotencyKey === op.idempotencyKey)?.prepared?.sourceDocuments?.find((d) => d.id === s.id)?.body ?? s.rawContent, templateName: s.templateName, labels: candidates.find((c) => c.key === s.id)?.sourceLabels,
    }));
    const preparation = [merge ? { label: "Combine sources into the retained template", prompt: "mergeSections" } : op.kind === "create" || options.restructureEnabled ? { label: options.restructureEnabled ? "Restructure content in the final template" : "Map content into template fields and HTML", prompt: options.restructureEnabled ? "restructure" : "compose" } : { label: "Preserve existing article fields" }, ...(options.standardsRules?.length ? [{ label: `Apply ${options.standardsRules.length} content standards`, prompt: "standards" }] : [])];
    const group = options.groups?.find((g) => g.survivorId === op.candidateKey);
    return { similarity: group?.averageSimilarity, preparation, key: op.idempotencyKey, title: op.title, kind: op.kind, merge, destinationId: op.kind === "revise" ? op.solutionId : undefined, templateName: op.templateName, sources,
      reason: group?.reason ?? op.proposal?.rationale ?? candidate?.why ?? (merge ? "These sources were selected to contribute to the retained article." : "Selected content will become this article."),
      coverage: [...new Set([...(op.proposal?.coverage ?? []), ...(op.mergeSources ?? []).flatMap((s) => s.proposal?.coverage ?? [])])], questions: [...new Set([...(op.proposal?.openQuestions ?? []), ...(op.mergeSources ?? []).flatMap((s) => s.proposal?.openQuestions ?? [])])], result: results.find((r) => r.idempotencyKey === op.idempotencyKey),
      comments: plan.filter((p): p is Extract<WriteOp, { kind: "flag" }> => p.kind === "flag" && p.survivorKey === op.candidateKey).map((p) => ({ key: p.idempotencyKey, sourceId: p.solutionId, title: sources.find((s) => s.id === p.solutionId)?.title ?? p.solutionId, result: results.find((r) => r.idempotencyKey === p.idempotencyKey) })),
    };
  });
  return { rows, counts: { created: rows.filter((r) => r.kind === "create").length, revised: rows.filter((r) => r.kind === "revise").length, merged: rows.filter((r) => r.merge).length, comments: rows.reduce((n, r) => n + r.comments.length, 0) } };
}

export function submissionMermaid(model: SubmissionGraphModel): string {
  const label = (s: string) => s.replace(/["<>\r\n]/g, " ");
  const lines = ["flowchart LR"];
  model.rows.forEach((r, i) => {
    lines.push(`a${i}["${r.merge ? "Merge" : r.kind === "create" ? "Create" : "Update"}"]`, `r${i}["${label(r.result?.prepared?.title ?? r.title)} — ${r.result?.outcome ?? "planned"}"]`, `a${i} --> r${i}`);
    r.sources.forEach((s, j) => lines.push(`s${i}_${j}["${label(s.title)}${s.existing ? ` (${s.id})` : " (proposal)"}"]`, `s${i}_${j} --> a${i}`));
    r.comments.forEach((c, j) => lines.push(`c${i}_${j}["Tracking comment: ${label(c.title)} — ${c.result?.outcome ?? "planned"}"]`, `r${i} -->|After merge succeeds| c${i}_${j}`));
  });
  return lines.join("\n");
}
