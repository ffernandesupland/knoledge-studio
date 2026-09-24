import { z } from "zod";

export const pipelineEvalDescriptorSchema = z.object({
  version: z.literal(1),
  path: z.string().min(1).max(80),
  draftKind: z.enum(["create", "revise"]),
  merged: z.boolean(),
  operations: z.array(z.string().min(1).max(160)).max(12),
  template: z.object({ name: z.string().max(240), fields: z.array(z.string().max(240)).max(100) }),
  context: z.object({ ground: z.boolean(), standards: z.boolean(), snippets: z.boolean(), demandRequirements: z.boolean() }),
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
  score: z.number().int().min(0).max(4),
  verdict: z.enum(["met", "partially_met", "not_met", "insufficient_evidence"]),
  explanation: z.string().min(1).max(1200),
  evidence: z.array(z.string().min(1).max(1000)).max(4),
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
  rubric: StoredEvalRubric;
  result: StoredEvalResult;
}

export interface EvalDashboardRubric extends StoredEvalRubric {
  evaluationCount: number;
  averageScore: number | null;
  latestResult?: StoredEvalResult;
}
