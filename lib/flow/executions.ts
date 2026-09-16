import { getJob } from "../autonomous/store";
import { autonomousOutcome, type AutonomousOutcome } from "../autonomous/outcome";
import { buildSubmissionGraph, type SubmissionGraphModel } from "../ks/submission-graph";
import { db } from "../db";
import { getRun } from "../db/runs";
import { loadExecution, executionResults } from "../pipeline/state";
import type { ExecuteArgs } from "../pipeline/execute";
import type { FlowNode } from "./model";

export interface ExecutedNode extends FlowNode { record?: unknown; children?: ExecutedNode[] }
export interface ExecutedFlow {
  outcome?: AutonomousOutcome;
  error?: string;
  mode?: "guided" | "autonomous";
  graph?: SubmissionGraphModel;
  version: 1; runId: string; createdAt: string; savedAt: string; status: string;
  title: string; costUsd: number; tree: ExecutedNode[];
}
export interface PastExecution { id: string; createdAt: string; status: string; costUsd: number; title: string }
interface AiRow { id: number; ts: string; phase: string; operation: string; model: string; prompt_version: string; input_tokens: number; output_tokens: number; cost_usd: number; request: string; response: string }
interface AuditRow { id: number; ts: string; op: string; idempotency_key: string; outcome: string; request: string; response: string | null; error: string | null; target: string | null }

/** A persisted projection of recorded facts. Never infers success or calls from scenario defaults. */
export async function saveExecutedFlow(runId: string): Promise<ExecutedFlow> {
  const run = (await getRun(runId));
  if (!run) throw new Error("Run not found");
  const autonomous = await getJob(runId);
  const execution = (await loadExecution<ExecuteArgs>(runId));
  const results = (await executionResults(runId));
  const calls = (await db().prepare("SELECT * FROM ai_calls WHERE run_id=? ORDER BY id").all(runId)) as AiRow[];
  const audits = (await db().prepare("SELECT * FROM write_audit WHERE run_id=? ORDER BY id").all(runId)) as AuditRow[];
  const node = (id: string, title: string, kind: FlowNode["kind"], detail: string, record?: unknown, children?: ExecutedNode[]): ExecutedNode => ({ id, title, kind, detail, record, children, active: true });
  const aiNodes = (phase: string) => calls.filter((c) => (c.phase === phase || c.phase === `autonomous:${phase}`)).map((c) => node(`call_${c.id}`, c.operation, "ai", `${c.ts} · ${c.model} · prompt ${c.prompt_version} · ${c.input_tokens} input / ${c.output_tokens} output tokens · $${c.cost_usd.toFixed(4)}`, { request: JSON.parse(c.request), response: JSON.parse(c.response) }));
  const choices = run.snapshot;
  const tree: ExecutedNode[] = [
    node("sources", "1 · Sources and selected options", "input", `${run.path ?? "Content"} · ${run.candidates.length} analyzed proposals · Enabled: ${run.operations.join(", ") || "No optional operations"}`, {
      pastedCharacters: run.inputText.length, attachments: run.attachments?.map((a) => ({ label: a.label, kind: a.kind ?? "not recorded", characters: a.text.length })), sourceSolutionIds: run.sourceIds, groundContext: run.groundContext, analysisOptions: run.operations,
    }),
    node("analysis", "2 · Recorded analysis", "logic", `${run.steps.length} completed tool steps · ${aiNodes("analysis").length} recorded AI calls. Tool steps and AI calls are separate records; not every API read has an individual event.`, undefined, [
      node("steps", "Completed tool steps", "logic", "Durations and costs recorded by the analysis pipeline.", run.steps),
      ...aiNodes("analysis"),
    ]),
    node("decisions", autonomous ? "3 · Proposals and agent decisions" : "3 · Proposals and author decisions", autonomous ? "ai" : "human", choices ? `${choices.selectedKeys.length} selected · ${choices.resolutions.filter((r) => r === "merged").length} merge decisions · ${choices.resolutions.filter((r) => r === "separate").length} keep-separate decisions.` : "No full decision snapshot recorded; available analysis decisions shown.", {
      proposals: (choices?.candidates ?? run.candidates).map((c) => ({ key: c.key, title: c.title, template: c.templateName, targetSolutionId: c.targetSolutionId, proposal: c.proposal, duplicates: c.duplicates, researchOnly: c.researchOnly })),
      selectedKeys: choices?.selectedKeys ?? run.decisions?.selectedKeys,
      groups: choices?.groups ?? run.groups, resolutions: choices?.resolutions ?? run.decisions?.resolutions,
    }),
    node("metadata", "4 · Final metadata and preparation options", autonomous ? "ai" : "human", execution ? execution.stage === "preparation" ? "Preparation options saved; changing the plan requires preparing drafts again." : "Options frozen when submission started; item records below show any reviewed template changes." : "Submission has not started.", execution ? { collection: execution.collection, language: execution.language, metadata: choices?.metadata, rewriteEnabled: execution.restructureEnabled, standardsRules: execution.standardsRules } : choices ? { collection: choices.collection, language: choices.language, metadata: choices.metadata, operations: choices.operations, standardsRules: choices.standardsRules } : undefined),
    node("preparation", "5 · Recorded article preparation", "logic", `${aiNodes("preparation").length} preparation calls · ${aiNodes("submission").length} submission calls. Prepared drafts are saved before RightAnswers writes.`, undefined, [...aiNodes("preparation"), ...aiNodes("submission")]),
    node("writes", "6 · Planned writes and actual outcomes", "logic", execution ? `${execution.plan.length} planned operations. Expand an item to inspect its saved preparation and attempt records.` : "No submission plan recorded; no writes are implied.", undefined, execution?.plan.map((op, i) => {
      const result = results.find((r) => r.idempotencyKey === op.idempotencyKey);
      const attempts = audits.filter((a) => a.idempotency_key === op.idempotencyKey || a.idempotency_key.startsWith(`${op.idempotencyKey}:`));
      return node(`write_${i}`, `${op.kind}: ${op.kind === "flag" ? op.solutionId : result?.title ?? op.title}`, result?.outcome === "ok" ? "write" : "stop", `${result?.outcome ?? "No result recorded"}${result?.solutionId ? ` · Solution ${result.solutionId}` : ""}${result?.message ? ` · ${result.message}` : ""}`, { planned: op, result, attempts: attempts.map((a) => ({ ...a, request: JSON.parse(a.request) })) });
    })),
    node("outcome", "7 · Saved run outcome", run.error ? "stop" : "logic", `${run.status} · total recorded AI cost $${run.costUsd.toFixed(4)}`, { error: run.error, outcomes: results.map((r) => ({ outcome: r.outcome, solutionId: r.solutionId, description: r.description, message: r.message })) }),
  ];
  if (autonomous) {
    tree.unshift(node("autonomous_authorization", "Autonomous authorization and execution", "input", `${autonomous.status} · ${autonomous.stage}. The app advances saved steps automatically for this opted-in run.`, autonomous.authorization));
    tree.push(node("agent_reviews", "Agent planning and quality reviews", "ai", "Every approval is tied to its prepared version. Detailed tool requests, responses, failures and decision evidence are in Agent decisions and activity below.", undefined, [...aiNodes("decisions"), ...aiNodes("review")]));
    tree[2].detail = "Analysis uses the existing pipeline and selected options. All autonomous tool/model activity is persisted separately, including retries and saved-read reuse.";
  }
  const flow: ExecutedFlow = { mode: autonomous ? "autonomous" : "guided", version: 1, runId, createdAt: run.createdAt, savedAt: new Date().toISOString(), status: run.status, title: run.candidates[0]?.title ?? "Content analysis", costUsd: run.costUsd, tree, graph: execution ? buildSubmissionGraph(execution.plan, choices?.candidates ?? run.candidates, results, { ...execution, groups: choices?.groups ?? run.groups }) : undefined };
  if (autonomous) { flow.outcome = await autonomousOutcome(autonomous, run, execution, results); flow.error = autonomous.error; }
  (await db().prepare("INSERT INTO flow_executions(run_id,saved_at,payload) VALUES (?,?,?) ON CONFLICT(run_id) DO UPDATE SET saved_at=excluded.saved_at,payload=excluded.payload").run(runId, flow.savedAt, JSON.stringify(flow)));
  return flow;
}
export async function readExecutedFlow(runId: string): Promise<ExecutedFlow | undefined> {
  const row = (await db().prepare("SELECT payload FROM flow_executions WHERE run_id=?").get(runId)) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : undefined;
}
/** Pagination and owner filtering happen before loading or backfilling any payload. */
export async function pastExecutions(author: string, offset = 0): Promise<{ runs: PastExecution[]; hasMore: boolean }> {
  const rows = (await db().prepare("SELECT id, created_at, status, cost_usd FROM runs WHERE author=? AND (status!='running' OR EXISTS (SELECT 1 FROM autonomous_jobs WHERE run_id=runs.id)) ORDER BY created_at DESC,id DESC LIMIT 21 OFFSET ?").all(author, offset)) as { id: string; created_at: string; status: string; cost_usd: number }[];
  return { hasMore: rows.length > 20, runs: await Promise.all(rows.slice(0, 20).map(async (r) => {
    const saved = (await readExecutedFlow(r.id)) ?? (await saveExecutedFlow(r.id));
    return { id: r.id, createdAt: r.created_at, status: r.status, costUsd: r.cost_usd, title: saved.title };
  })) };
}
