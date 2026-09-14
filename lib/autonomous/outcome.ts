import { db } from "../db";
import type { StoredRun } from "../db/runs";
import type { ExecuteArgs, OpResult } from "../pipeline/execute";
import { checkpoint } from "./store";
import { canResumePlanning } from "./recovery";
import { unselectedMergeGroups } from "./plan";
import type { AutonomousJob, AutonomousStage } from "./types";

export interface AutonomousOutcome {
  stages: { key: string; label: string; status: "completed" | "active" | "stopped" | "pending" }[];
  failedStage?: string;
  submitted: number;
  prepared: number;
  proposals: { key: string; title: string; reason?: string }[];
  canResume: boolean;
}
export async function autonomousOutcome(job: AutonomousJob, run: StoredRun | null | undefined, execution: ExecuteArgs | undefined, results: OpResult[]): Promise<AutonomousOutcome> {
  const active = ["queued", "running"].includes(job.status);
  const lastError = active ? undefined : await db().prepare("SELECT stage FROM autonomous_events WHERE run_id=? AND kind='error' ORDER BY id DESC LIMIT 1").get(job.runId) as { stage: AutonomousStage } | undefined;
  const articles = execution?.plan.filter(p => p.kind !== "flag") ?? [];
  const analysisDone = !!await checkpoint(job.runId, "analysis-complete");
  const decisionsDone = !!await checkpoint(job.runId, "decisions") && (!job.input.operations.includes("Discover and suggest metadata") || !!await checkpoint(job.runId, "metadata-complete"));
  const reviewed = articles.length > 0 && (await Promise.all(articles.map(p => checkpoint(job.runId, `review-complete:${p.idempotencyKey}`)))).every(Boolean);
  const labels = [
    ["analysis", "Analyze sources", analysisDone],
    ["decisions", "Choose actions and metadata", decisionsDone],
    ["preparation", "Prepare articles", articles.length > 0 && articles.every(p => results.some(r => r.idempotencyKey === p.idempotencyKey && r.prepared))],
    ["review", "Review article quality", reviewed],
    ["submission", "Submit to RightAnswers", job.status === "completed"],
  ] as const;
  const errorStage = lastError?.stage === "analysis" && analysisDone || lastError?.stage === "decisions" && decisionsDone ? undefined : lastError?.stage;
  const contradictory = run?.snapshot && execution?.plan.length === 0 && unselectedMergeGroups(run.snapshot).length > 0;
  const stopped = contradictory ? "decisions" : errorStage ?? (!analysisDone ? "analysis" : !decisionsDone ? "decisions" : "submission");
  return {
    stages: labels.map(([key, label, done]) => ({ key, label, status: !active && job.status !== "completed" && key === stopped ? "stopped" : done ? "completed" : active && (job.stage === key || job.stage === "queued" && key === "analysis") ? "active" : "pending" })),
    failedStage: !active && job.status !== "completed" ? labels.find(([key]) => key === stopped)?.[1] : undefined,
    submitted: results.filter(r => r.kind !== "flag" && r.outcome === "ok").length,
    prepared: results.filter(r => r.kind !== "flag" && r.prepared).length,
    proposals: (run?.candidates ?? []).map(c => ({ key: c.key, title: c.title, reason: c.why })),
    canResume: await canResumePlanning(job),
  };
}
