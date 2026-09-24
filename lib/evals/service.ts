import { createHash } from "node:crypto";
import type { StoredRun } from "../db/runs";
import { PROMPT_VERSION } from "../llm/audit";
import type { UntrustedBlock } from "../llm/prompt";
import type { ExecuteArgs, PreparedContent } from "../pipeline/execute";
import { compileEvaluationRubric, judgePreparedDraft } from "./operations";
import { createEvalResult, createEvalRubric, findEvalResult, findEvalRubric } from "./store";
import type { EvaluationJudgment, EvaluationResponse, PipelineEvalDescriptor, StoredEvalRubric } from "./types";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(",")}}`;
  return JSON.stringify(value);
}

export function buildPipelineEvalDescriptor(run: StoredRun, execution: ExecuteArgs, idempotencyKey: string, prepared: PreparedContent): PipelineEvalDescriptor {
  const op = execution.plan.find(candidate => candidate.idempotencyKey === idempotencyKey);
  if (!op || op.kind === "flag") throw new Error("This output is not eligible for evaluation");
  return {
    version: 1,
    path: run.path ?? "knowledge_studio",
    draftKind: op.kind,
    merged: Boolean(op.mergeSources?.length),
    operations: [...new Set(run.operations)].sort(),
    template: { name: prepared.templateName, fields: prepared.fields.map(field => field.fieldName).sort() },
    context: { ground: Boolean(prepared.groundContext?.selection.enabled), standards: Boolean(prepared.standardsApplied || prepared.ruleResults?.length), snippets: Boolean(prepared.snippetIds?.length), demandRequirements: Boolean(run.demandSpecification) },
  };
}

export function evaluationSignature(descriptor: PipelineEvalDescriptor) {
  return createHash("sha256").update(canonical(descriptor)).digest("hex");
}

export function scenarioLabel(descriptor: PipelineEvalDescriptor) {
  const operations = descriptor.operations.length ? descriptor.operations.join(" + ") : "Draft preparation";
  return `${descriptor.path} · ${descriptor.draftKind}${descriptor.merged ? " merge" : ""} · ${operations}`;
}

export function scoreJudgment(rubric: StoredEvalRubric["rubric"], judgment: EvaluationJudgment) {
  const byId = new Map(judgment.criteria.map(criterion => [criterion.criterionId, criterion]));
  if (byId.size !== rubric.criteria.length || rubric.criteria.some(criterion => !byId.has(criterion.id))) throw new Error("The evaluator did not score every fixed rubric criterion");
  const totalWeight = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight, 0);
  const earned = rubric.criteria.reduce((sum, criterion) => sum + criterion.weight * (byId.get(criterion.id)?.score ?? 0), 0);
  return Math.round((earned / (totalWeight * 4)) * 1000) / 10;
}

function evaluationBlocks(run: StoredRun, execution: ExecuteArgs, idempotencyKey: string, prepared: PreparedContent): UntrustedBlock[] {
  const op = execution.plan.find(candidate => candidate.idempotencyKey === idempotencyKey);
  // Preserve predictable evaluation cost and stay below the shared model-input limit.
  // The draft is the primary evidence; source and run context are supporting evidence.
  const bounded = (value: unknown, max: number) => {
    const text = JSON.stringify(value);
    return text.length <= max ? text : `${text.slice(0, max)}\n[Truncated for evaluation input limits]`;
  };
  return [
    { label: "Prepared draft", content: bounded({ title: prepared.title, summary: prepared.summary, keywords: prepared.keywords, template: prepared.templateName, fields: prepared.fields }, 220_000) },
    { label: "Source material", content: bounded({ sourceDocuments: prepared.sourceDocuments, source: op && op.kind !== "flag" ? op.rawContent : undefined }, 160_000) },
    { label: "Grounding evidence", content: bounded(prepared.grounding ?? null, 70_000) },
    { label: "Run requirements", content: bounded(run.demandSpecification ?? null, 30_000) },
  ];
}

export async function evaluatePreparedDraft(input: { run: StoredRun; execution: ExecuteArgs; idempotencyKey: string; prepared: PreparedContent }): Promise<EvaluationResponse> {
  const descriptor = buildPipelineEvalDescriptor(input.run, input.execution, input.idempotencyKey, input.prepared);
  const signature = evaluationSignature(descriptor);
  let rubric = await findEvalRubric(signature);
  if (!rubric) {
    const compiled = await compileEvaluationRubric(descriptor);
    rubric = await createEvalRubric({ signature, scenarioLabel: scenarioLabel(descriptor), pipeline: descriptor, rubric: compiled.data, compilerModel: compiled.model, promptVersion: PROMPT_VERSION });
  }
  const prior = await findEvalResult(input.run.id, input.idempotencyKey, input.prepared.version, rubric.id);
  if (prior) return { cached: true, rubric, result: prior };
  const judged = await judgePreparedDraft(rubric.rubric, evaluationBlocks(input.run, input.execution, input.idempotencyKey, input.prepared));
  const saved = await createEvalResult({ runId: input.run.id, idempotencyKey: input.idempotencyKey, preparedVersion: input.prepared.version, rubricId: rubric.id, judgeModel: judged.model, judgment: judged.data, score: scoreJudgment(rubric.rubric, judged.data) });
  return { cached: saved.cached, rubric, result: saved.result };
}
