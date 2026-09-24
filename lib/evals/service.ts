import { createHash, randomUUID } from "node:crypto";
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
  template_contract: { label: "Template contract", action: "Validate target template" },
  merge_integrity: { label: "Merge integrity", action: "Merge duplicate sources" },
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
  const requested = new Set(run.snapshot?.operations.filter(operation => operation.on).map(operation => operation.name) ?? run.operations);
  const dimensions: DimensionRequest[] = [];
  const add = (dimension: EvaluationDimension, configuration: unknown, rubricBlocks: UntrustedBlock[], judgeBlocks: UntrustedBlock[]) => dimensions.push({ descriptor: descriptor(dimension, configuration), rubricBlocks, judgeBlocks: [draft, ...judgeBlocks] });
  // Applied artifacts, rather than a toggle alone, determine what can be measured.
  if (prepared.standardsApplied || prepared.ruleResults?.length) {
    const standards = prepared.standardsUsed ?? [];
    add("content_standards", standards, [{ label: "Frozen content standards", content: bounded(standards, 120_000) }], [{ label: "Applied content standards", content: bounded({ standards, ruleResults: prepared.ruleResults ?? [] }, 140_000) }]);
  }
  if (prepared.groundContext?.selection.enabled) add("ground_context", prepared.groundContext, [], [{ label: "Grounding evidence", content: bounded(prepared.grounding ?? null, 100_000) }, { label: "Source material", content: bounded({ sourceDocuments: prepared.sourceDocuments, source: op.rawContent }, 100_000) }]);
  if (run.demandSpecification && prepared.demandCompliance) add("demand_requirements", run.demandSpecification, [{ label: "Demand requirements", content: bounded(run.demandSpecification, 50_000) }], [{ label: "Demand requirements", content: bounded(run.demandSpecification, 50_000) }, { label: "Demand compliance assessment", content: bounded(prepared.demandCompliance, 80_000) }]);
  if (execution.restructureEnabled) add("content_structure", { action: "Restructure content", version: 1 }, [], []);
  if (requested.has("Optimize for search")) add("search_optimization", { action: "Optimize for search", version: 1 }, [], []);
  if (prepared.metadata) add("metadata_selection", prepared.metadata, [], [{ label: "Selected metadata", content: bounded(prepared.metadata, 30_000) }]);
  if (op.mergeSources?.length) add("merge_integrity", { sources: op.mergeSources.map(source => ({ id: source.id, sourceVersion: source.sourceVersion })), targetTemplate: prepared.templateContract }, [], [{ label: "Merge source material", content: bounded({ sourceDocuments: prepared.sourceDocuments, targetTemplate: prepared.templateContract }, 180_000) }]);
  return dimensions;
}

type CoverageItem = EvaluationResponse["coverage"][number];
function evaluationCoverage(run: StoredRun, execution: ExecuteArgs, idempotencyKey: string, prepared: PreparedContent, dimensions: DimensionRequest[]): CoverageItem[] {
  const op = execution.plan.find(candidate => candidate.idempotencyKey === idempotencyKey);
  if (!op || op.kind === "flag") return [];
  const requested = new Set(run.snapshot?.operations.filter(operation => operation.on).map(operation => operation.name) ?? run.operations);
  const scored = new Set(dimensions.map(dimension => dimension.descriptor.dimension));
  const item = (dimension: string, label: string, status: CoverageItem["status"], reason: string): CoverageItem => ({ dimension, label, status, reason });
  const coverage: CoverageItem[] = [];
  if (requested.has("Apply content standards") || prepared.standardsApplied) coverage.push(item("content_standards", dimensionMeta.content_standards.label, scored.has("content_standards") ? "scored" : "not_run", scored.has("content_standards") ? "The frozen standards and their rule results were retained with this draft." : "No applied standards artifact was retained for this draft."));
  if (prepared.groundContext?.selection.enabled) coverage.push(item("ground_context", dimensionMeta.ground_context.label, scored.has("ground_context") ? "scored" : "not_run", scored.has("ground_context") ? "The saved grounding evidence was evaluated." : "Grounding was enabled but no evaluable evidence was retained."));
  if (run.demandSpecification) coverage.push(item("demand_requirements", dimensionMeta.demand_requirements.label, scored.has("demand_requirements") ? "scored" : "not_run", scored.has("demand_requirements") ? "The saved demand-compliance assessment was evaluated." : "Demand requirements exist, but this draft has no saved compliance assessment."));
  if (execution.restructureEnabled) coverage.push(item("content_structure", dimensionMeta.content_structure.label, scored.has("content_structure") ? "scored" : "not_run", "The preparation stage rewrote the draft into its selected template."));
  if (requested.has("Optimize for search")) coverage.push(item("search_optimization", dimensionMeta.search_optimization.label, scored.has("search_optimization") ? "scored" : "not_run", scored.has("search_optimization") ? "The final title, keywords, and content were evaluated." : "No search-optimization artifact was retained."));
  if (requested.has("Discover and suggest metadata") || prepared.metadata) coverage.push(item("metadata_selection", dimensionMeta.metadata_selection.label, scored.has("metadata_selection") ? "scored" : "not_run", scored.has("metadata_selection") ? "The final metadata selected for this draft was evaluated." : "No final metadata selection was retained."));
  if (requested.has("Find duplicates")) coverage.push(item("merge_integrity", dimensionMeta.merge_integrity.label, op.mergeSources?.length ? (scored.has("merge_integrity") ? "scored" : "not_run") : "not_applicable", op.mergeSources?.length ? "The merged source set was evaluated against the retained target." : "This output did not merge duplicate sources."));
  if (requested.has("Split topics")) coverage.push(item("topic_separation", "Topic separation", "not_run", "This requires a run-level comparison across all planned outputs; it is not truthfully measurable from one draft."));
  if (requested.has("Find gaps")) coverage.push(item("gap_coverage", dimensionMeta.gap_coverage.label, "not_run", "This requires retrieval and gap-analysis evidence; it is not truthfully measurable from one prepared draft."));
  if (prepared.snippetIds?.length) coverage.push(item("snippets", dimensionMeta.snippets.label, "not_run", "Only snippet identifiers were retained. The frozen snippet HTML and its intended use are required before this can be scored."));
  if (!prepared.readyForSubmission) coverage.push(item("draft_readiness", "Draft readiness", "blocked", "This draft is incomplete or blocked, so this diagnostic result is excluded from comparison KPIs."));
  return coverage;
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

async function evaluateDimension(input: { run: StoredRun; idempotencyKey: string; prepared: PreparedContent; dimension: DimensionRequest; persist: boolean }) {
  const signature = evaluationSignature(input.dimension.descriptor);
  let rubric = await findEvalRubric(signature);
  if (!rubric) {
    const compiled = await compileEvaluationRubric(input.dimension.descriptor, input.dimension.rubricBlocks);
    rubric = await createEvalRubric({ signature, scenarioLabel: scenarioLabel(input.dimension.descriptor), pipeline: input.dimension.descriptor, rubric: compiled.data, compilerModel: compiled.model, promptVersion: PROMPT_VERSION });
  }
  if (input.persist) {
    const prior = await findEvalResult(input.run.id, input.idempotencyKey, input.prepared.version, rubric.id);
    if (prior) return { rubric, result: prior, cached: true };
  }
  const judged = await judgePreparedDraft(rubric.rubric, input.dimension.judgeBlocks);
  const score = scoreJudgment(rubric.rubric, judged.data);
  if (!input.persist) return { rubric, result: { id: `diagnostic-${randomUUID()}`, runId: input.run.id, idempotencyKey: input.idempotencyKey, preparedVersion: input.prepared.version, rubricId: rubric.id, judgeModel: judged.model, judgment: judged.data, score, createdAt: new Date().toISOString() }, cached: false };
  const saved = await createEvalResult({ runId: input.run.id, idempotencyKey: input.idempotencyKey, preparedVersion: input.prepared.version, rubricId: rubric.id, judgeModel: judged.model, judgment: judged.data, score });
  return { rubric, result: saved.result, cached: saved.cached };
}

export async function evaluatePreparedDraft(input: { run: StoredRun; execution: ExecuteArgs; idempotencyKey: string; prepared: PreparedContent }): Promise<EvaluationResponse> {
  const dimensions = buildEvaluationDimensions(input.run, input.execution, input.idempotencyKey, input.prepared);
  if (!dimensions.length) throw new Error("No requested pipeline dimension is available to evaluate for this draft");
  const kpiEligible = input.prepared.readyForSubmission === true;
  const evaluations = [];
  for (const dimension of dimensions) evaluations.push(await evaluateDimension({ ...input, dimension, persist: kpiEligible }));
  return { cached: evaluations.every(evaluation => evaluation.cached), score: Math.round((evaluations.reduce((sum, evaluation) => sum + evaluation.result.score, 0) / evaluations.length) * 10) / 10, kpiEligible, evaluations, coverage: evaluationCoverage(input.run, input.execution, input.idempotencyKey, input.prepared, dimensions) };
}
