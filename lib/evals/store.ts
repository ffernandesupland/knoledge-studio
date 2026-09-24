import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { EvaluationJudgment, EvaluationRubric, PipelineEvalDescriptor, StoredEvalResult, StoredEvalRubric } from "./types";

type RubricRow = { id: string; signature: string; scenario_label: string; pipeline_json: string; rubric_json: string; compiler_model: string; prompt_version: string; revision: number; created_at: string };
type ResultRow = { id: string; run_id: string; idempotency_key: string; prepared_version: string; rubric_id: string; judge_model: string; result_json: string; score: number; created_at: string };
const rubricFrom = (row: RubricRow): StoredEvalRubric => ({ id: row.id, signature: row.signature, scenarioLabel: row.scenario_label, pipeline: JSON.parse(row.pipeline_json), rubric: JSON.parse(row.rubric_json), compilerModel: row.compiler_model, promptVersion: row.prompt_version, revision: row.revision, createdAt: row.created_at });
const resultFrom = (row: ResultRow): StoredEvalResult => ({ id: row.id, runId: row.run_id, idempotencyKey: row.idempotency_key, preparedVersion: row.prepared_version, rubricId: row.rubric_id, judgeModel: row.judge_model, judgment: JSON.parse(row.result_json), score: row.score, createdAt: row.created_at });

export async function findEvalRubric(signature: string) {
  const row = await db().prepare("SELECT * FROM eval_rubrics WHERE signature=?").get(signature) as RubricRow | undefined;
  return row ? rubricFrom(row) : undefined;
}

export async function createEvalRubric(input: { signature: string; scenarioLabel: string; pipeline: PipelineEvalDescriptor; rubric: EvaluationRubric; compilerModel: string; promptVersion: string }) {
  const createdAt = new Date().toISOString();
  await db().prepare(`INSERT INTO eval_rubrics(id,signature,scenario_label,pipeline_json,rubric_json,compiler_model,prompt_version,revision,created_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(signature) DO NOTHING`).run(randomUUID(), input.signature, input.scenarioLabel, JSON.stringify(input.pipeline), JSON.stringify(input.rubric), input.compilerModel, input.promptVersion, 1, createdAt);
  const stored = await findEvalRubric(input.signature);
  if (!stored) throw new Error("Could not save the evaluation rubric");
  return stored;
}

export async function findEvalResult(runId: string, idempotencyKey: string, preparedVersion: string, rubricId: string) {
  const row = await db().prepare("SELECT * FROM eval_results WHERE run_id=? AND idempotency_key=? AND prepared_version=? AND rubric_id=?").get(runId, idempotencyKey, preparedVersion, rubricId) as ResultRow | undefined;
  return row ? resultFrom(row) : undefined;
}

export async function createEvalResult(input: { runId: string; idempotencyKey: string; preparedVersion: string; rubricId: string; judgeModel: string; judgment: EvaluationJudgment; score: number }) {
  const createdAt = new Date().toISOString();
  const insert = await db().prepare(`INSERT INTO eval_results(id,run_id,idempotency_key,prepared_version,rubric_id,judge_model,result_json,score,created_at)
    VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(run_id,idempotency_key,prepared_version,rubric_id) DO NOTHING`).run(randomUUID(), input.runId, input.idempotencyKey, input.preparedVersion, input.rubricId, input.judgeModel, JSON.stringify(input.judgment), input.score, createdAt);
  const stored = await findEvalResult(input.runId, input.idempotencyKey, input.preparedVersion, input.rubricId);
  if (!stored) throw new Error("Could not save the evaluation result");
  return { result: stored, cached: !insert.changes };
}

export async function listEvalDashboard(author: string) {
  const rubricRows = await db().prepare(`SELECT DISTINCT rubric.* FROM eval_rubrics rubric
    JOIN eval_results result ON result.rubric_id=rubric.id
    JOIN runs run ON run.id=result.run_id
    WHERE run.author=? ORDER BY rubric.created_at DESC`).all(author) as RubricRow[];
  const resultRows = await db().prepare(`SELECT result.* FROM eval_results result JOIN runs run ON run.id=result.run_id
    WHERE run.author=? ORDER BY result.created_at DESC`).all(author) as ResultRow[];
  return rubricRows.map(row => {
    const rubric = rubricFrom(row);
    const results = resultRows.filter(result => result.rubric_id === rubric.id).map(resultFrom);
    return { ...rubric, evaluationCount: results.length, averageScore: results.length ? results.reduce((sum, result) => sum + result.score, 0) / results.length : null, latestResult: results[0] };
  }).filter(rubric => rubric.pipeline.version === 2);
}
