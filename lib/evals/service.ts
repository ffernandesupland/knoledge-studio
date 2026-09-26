import { createHash } from "node:crypto";
import type { StoredRun } from "../db/runs";
import { PROMPT_VERSION } from "../llm/audit";
import type { UntrustedBlock } from "../llm/prompt";
import type { ExecuteArgs, PreparedContent } from "../pipeline/execute";
import { compileEvaluationRubric, judgePreparedDraft } from "./operations";
import { createEvalResult, createEvalRubric, findEvalResult, findEvalRubric } from "./store";
import type { EvaluationDimension, EvaluationJudgment, EvaluationResponse, PipelineEvalDescriptor, StoredEvalRubric } from "./types";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
const hash = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
const bounded = (value: unknown, max: number) => {
  const text = JSON.stringify(value);
  return text.length <= max ? text : `${text.slice(0, max)}\n[Truncated for evaluation input limits]`;
};

type DimensionRequest = { descriptor: PipelineEvalDescriptor; rubricBlocks: UntrustedBlock[]; judgeBlocks: UntrustedBlock[] };
const dimensionMeta: Record<EvaluationDimension, { label: string; action: string }> = {
  content_standards: { label: "Content standards", action: "Apply content standards" },
  ground_context: { label: "Ground context", action: "Use Ground Context" },
  demand_requirements: { label: "Demand requirements", action: "Apply demand requirements" },
  content_structure: { label: "Content structure", action: "Restructure content" },
  search_optimization: { label: "Search optimization", action: "Optimize for search" },
  metadata_selection: { label: "Metadata selection", action: "Discover and suggest metadata" },
  gap_coverage: { label: "Gap coverage", action: "Find gaps" },
  snippets: { label: "Reusable snippets", action: "Use reusable snippets" },
  deduplication: { label: "Deduplication", action: "Find duplicates" },
};

function draftBlock(prepared: PreparedContent): UntrustedBlock {
  return { label: "Prepared draft", content: bounded({ title: prepared.title, summary: prepared.summary, keywords: prepared.keywords, template: prepared.templateName, fields: prepared.fields }, 260_000) };
}
function descriptor(dimension: EvaluationDimension, configuration: unknown): PipelineEvalDescriptor {
  const meta = dimensionMeta[dimension];
  // Version changes whenever rubric semantics change, preventing an older broad rubric
  // from being silently reused after its scoring rules have been corrected.
  return { version: 3, dimension, dimensionLabel: meta.label, action: meta.action, configurationIdentity: hash(configuration) };
}

/** Builds a composable set of dimensions from actions actually requested and used. */
export function buildEvaluationDimensions(run: StoredRun, execution: ExecuteArgs, idempotencyKey: string, prepared: PreparedContent): DimensionRequest[] {
  const op = execution.plan.find(candidate => candidate.idempotencyKey === idempotencyKey);
  if (!op || op.kind === "flag") throw new Error("This output is not eligible for evaluation");
  const draft = draftBlock(prepared);
  const requested = new Set(run.operations);
  const dimensions: DimensionRequest[] = [];
  const add = (dimension: EvaluationDimension, configuration: unknown, rubricBlocks: UntrustedBlock[], judgeBlocks: UntrustedBlock[]) => dimensions.push({ descriptor: descriptor(dimension, configuration), rubricBlocks, judgeBlocks: [draft, ...judgeBlocks] });
  if (requested.has("Apply content standards") && (prepared.standardsApplied || prepared.ruleResults?.length)) {
    const standards = prepared.standardsUsed ?? [];
    add("content_standards", standards, [{ label: "Frozen content standards", content: bounded(standards, 120_000) }], [{ label: "Applied content standards", content: bounded({ standards, ruleResults: prepared.ruleResults ?? [] }, 140_000) }]);
  }
  if (prepared.groundContext?.selection.enabled) add("ground_context", prepared.groundContext, [], [{ label: "Grounding evidence", content: bounded(prepared.grounding ?? null, 100_000) }, { label: "Source material", content: bounded({ sourceDocuments: prepared.sourceDocuments, source: op.rawContent }, 100_000) }]);
  if (run.demandSpecification) add("demand_requirements", run.demandSpecification, [{ label: "Demand requirements", content: bounded(run.demandSpecification, 50_000) }], [{ label: "Demand requirements", content: bounded(run.demandSpecification, 50_000) }]);
  if (requested.has("Restructure content")) add("content_structure", { action: "Restructure content", version: 1 }, [], []);
  if (requested.has("Optimize for search")) add("search_optimization", { action: "Optimize for search", version: 1 }, [], []);
  if (requested.has("Discover and suggest metadata") && prepared.metadata) add("metadata_selection", prepared.metadata, [], [{ label: "Selected metadata", content: bounded(prepared.metadata, 30_000) }]);
  if (requested.has("Find gaps")) add("gap_coverage", { action: "Find gaps", version: 1 }, [], [{ label: "Source material", content: bounded({ sourceDocuments: prepared.sourceDocuments, source: op.rawContent }, 120_000) }]);
  if (prepared.snippetIds?.length) add("snippets", [...prepared.snippetIds].sort(), [], [{ label: "Available snippet IDs", content: bounded(prepared.snippetIds, 20_000) }]);
  const candidate = (run.candidates ?? []).find(item => item.key === op.candidateKey);
  const group = candidate?.dupeGroup == null ? undefined : (run.groups ?? [])[candidate.dupeGroup];
  // A duplicate result is only meaningful when this output has actual match or group evidence.
  // Do not manufacture a generic quality score for normal outputs just because the pipeline
  // happened to request duplicate analysis.
  if (requested.has("Find duplicates") && candidate && (candidate.duplicates.length || group)) {
    const resolution = candidate.dupeGroup == null ? undefined : run.decisions?.resolutions[candidate.dupeGroup];
    add("deduplication", { action: "Find duplicates", version: 1 }, [{
      label: "Fixed deduplication assessment policy",
      content: bounded({
        version: 1,
        scope: "Assess only the duplicate-handling decision represented in the evidence. Do not grade prose quality, writing style, metadata, or publishing readiness.",
        checks: [
          "The cited overlap evidence supports the proposed duplicate relationship or a decision to keep items separate.",
          "The final decision is explicit and consistent with the candidate and duplicate-group evidence.",
          "When a merge is selected, the retained destination and included sources are unambiguous and consistent with the decision.",
          "When sources are excluded or left separate, the decision explains the boundary without inventing unsupported claims.",
        ],
      }, 30_000),
    }], [{
      label: "Deduplication decision evidence",
      content: bounded({
        candidate: {
          id: candidate.key,
          title: candidate.title,
          proposedAction: candidate.action,
          rationale: candidate.why,
          duplicateMatches: candidate.duplicates,
        },
        duplicateGroup: group ? {
          members: group.members,
          survivorId: group.survivorId,
          averageSimilarity: group.averageSimilarity,
          rationale: group.reason,
          manuallySelected: group.manualSelection ?? false,
        } : null,
        recordedDecision: resolution ?? (group ? "not yet resolved" : "No merge group was created"),
        selectedForExecution: run.decisions?.selectedKeys.includes(candidate.key) ?? true,
        resultingWrite: {
          kind: op.kind,
          destinationId: op.kind === "revise" ? op.solutionId : null,
          mergesSources: op.mergeSources?.map(source => ({ id: source.id, title: source.title })) ?? [],
          isMergedRevision: op.kind === "revise" ? op.fromMerge : !!op.mergeSources?.length,
        },
      }, 100_000),
    }]);
  }
  return dimensions;
}

export function evaluationSignature(value: PipelineEvalDescriptor) { return hash(value); }
export function scenarioLabel(value: PipelineEvalDescriptor) { return `${value.dimensionLabel} · ${value.action}`; }

export function scoreJudgment(rubric: StoredEvalRubric["rubric"], judgment: EvaluationJudgment) {
  const byId = new Map(judgment.criteria.map(criterion => [criterion.criterionId, criterion]));
  if (byId.size !== rubric.criteria.length || rubric.criteria.some(criterion => !byId.has(criterion.id))) throw new Error("The evaluator did not score every fixed rubric criterion");
  const applicable = rubric.criteria.filter(criterion => byId.get(criterion.id)?.verdict !== "not_applicable");
  if (!applicable.length) throw new Error("The evaluator found no applicable rubric criteria");
  const totalWeight = applicable.reduce((sum, criterion) => sum + criterion.weight, 0);
  const earned = applicable.reduce((sum, criterion) => sum + criterion.weight * (byId.get(criterion.id)?.score ?? 0), 0);
  return Math.round((earned / (totalWeight * 4)) * 1000) / 10;
}

async function evaluateDimension(input: { run: StoredRun; idempotencyKey: string; prepared: PreparedContent; dimension: DimensionRequest }) {
  const signature = evaluationSignature(input.dimension.descriptor);
  let rubric = await findEvalRubric(signature);
  if (!rubric) {
    const compiled = await compileEvaluationRubric(input.dimension.descriptor, input.dimension.rubricBlocks);
    rubric = await createEvalRubric({ signature, scenarioLabel: scenarioLabel(input.dimension.descriptor), pipeline: input.dimension.descriptor, rubric: compiled.data, compilerModel: compiled.model, promptVersion: PROMPT_VERSION });
  }
  const prior = await findEvalResult(input.run.id, input.idempotencyKey, input.prepared.version, rubric.id);
  if (prior) return { rubric, result: prior, cached: true };
  const judged = await judgePreparedDraft(rubric.rubric, input.dimension.judgeBlocks);
  const saved = await createEvalResult({ runId: input.run.id, idempotencyKey: input.idempotencyKey, preparedVersion: input.prepared.version, rubricId: rubric.id, judgeModel: judged.model, judgment: judged.data, score: scoreJudgment(rubric.rubric, judged.data) });
  return { rubric, result: saved.result, cached: saved.cached };
}

export async function evaluatePreparedDraft(input: { run: StoredRun; execution: ExecuteArgs; idempotencyKey: string; prepared: PreparedContent }): Promise<EvaluationResponse> {
  const dimensions = buildEvaluationDimensions(input.run, input.execution, input.idempotencyKey, input.prepared);
  if (!dimensions.length) throw new Error("No requested pipeline dimension is available to evaluate for this draft");
  const evaluations = [];
  for (const dimension of dimensions) evaluations.push(await evaluateDimension({ ...input, dimension }));
  return { cached: evaluations.every(evaluation => evaluation.cached), score: Math.round((evaluations.reduce((sum, evaluation) => sum + evaluation.result.score, 0) / evaluations.length) * 10) / 10, evaluations };
}
