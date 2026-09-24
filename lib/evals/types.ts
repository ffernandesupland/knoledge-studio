import { z } from "zod";

export const evaluationDimensionSchema = z.enum(["content_standards", "ground_context", "demand_requirements", "content_structure", "search_optimization", "metadata_selection", "gap_coverage", "snippets", "template_contract", "merge_integrity"]);
export type EvaluationDimension = z.infer<typeof evaluationDimensionSchema>;

export const pipelineEvalDescriptorSchema = z.object({
  version: z.literal(3),
  dimension: evaluationDimensionSchema,
  dimensionLabel: z.string().min(1).max(120),
  action: z.string().min(1).max(160),
  configurationIdentity: z.string().min(1).max(160),
});
export type PipelineEvalDescriptor = z.infer<typeof pipelineEvalDescriptorSchema>;

export const rubricCriterionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/),
  title: z.string().min(1).max(140),
  description: z.string().min(1).max(800),
  weight: z.number().int().min(1).max(5),
  evidenceRequired: z.string().min(1).max(400),
});
export const evaluationRubricSchema = z.object({
  title: z.string().min(1).max(200),
  summary: z.string().min(1).max(800),
  criteria: z.array(rubricCriterionSchema).min(4).max(8).superRefine((criteria, context) => {
    if (new Set(criteria.map(criterion => criterion.id)).size !== criteria.length) context.addIssue({ code: "custom", message: "Criterion IDs must be unique" });
  }),
});
export type EvaluationRubric = z.infer<typeof evaluationRubricSchema>;

export const evaluationCriterionResultSchema = z.object({
  criterionId: z.string().regex(/^[a-z][a-z0-9_]{1,60}$/),
  score: z.number().int().min(0).max(4).nullable(),
  verdict: z.enum(["met", "partially_met", "not_met", "insufficient_evidence", "not_applicable"]),
  explanation: z.string().min(1).max(1200),
  evidence: z.array(z.string().min(1).max(1000)).max(4),
}).superRefine((result, context) => {
  if (result.verdict === "not_applicable" && result.score !== null) context.addIssue({ code: "custom", message: "Not-applicable criteria must have a null score" });
  if (result.verdict !== "not_applicable" && result.score === null) context.addIssue({ code: "custom", message: "Scored criteria require a 0–4 score" });
});
export const evaluationJudgmentSchema = z.object({
  summary: z.string().min(1).max(1600),
  criteria: z.array(evaluationCriterionResultSchema).min(4).max(8),
});
export type EvaluationJudgment = z.infer<typeof evaluationJudgmentSchema>;

export interface StoredEvalRubric {
  id: string;
  signature: string;
  scenarioLabel: string;
  pipeline: PipelineEvalDescriptor;
  rubric: EvaluationRubric;
  compilerModel: string;
  promptVersion: string;
  revision: number;
  createdAt: string;
}

export interface StoredEvalResult {
  id: string;
  runId: string;
  idempotencyKey: string;
  preparedVersion: string;
  rubricId: string;
  judgeModel: string;
  judgment: EvaluationJudgment;
  score: number;
  createdAt: string;
}

export interface EvaluationResponse {
  cached: boolean;
  score: number;
  kpiEligible: boolean;
  evaluations: Array<{ rubric: StoredEvalRubric; result: StoredEvalResult; cached: boolean }>;
  coverage: Array<{ dimension: string; label: string; status: "scored" | "not_applicable" | "not_run" | "blocked"; reason: string }>;
}

export interface EvalDashboardRubric extends StoredEvalRubric {
  evaluationCount: number;
  averageScore: number | null;
  latestResult?: StoredEvalResult;
}
