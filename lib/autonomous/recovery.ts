import { db } from "../db";
import { ApiError } from "../api/auth";
import { checkpoint, event, getJob } from "./store";
import { AUTONOMOUS_POLICY_VERSION, DECISION_REPAIR_KEY, MAX_DECISION_ATTEMPTS, type AutonomousJob } from "./types";
import type { DecisionSnapshot } from "../db/runs";
import { loadExecution } from "../pipeline/state";
import type { ExecuteArgs } from "../pipeline/execute";
import { unselectedMergeGroups } from "./plan";

async function emptyContradictoryPlan(runId: string) {
  const snapshot = await checkpoint<DecisionSnapshot>(runId, "decisions");
  const execution = await loadExecution<ExecuteArgs>(runId);
  return snapshot && unselectedMergeGroups(snapshot).length > 0 && execution?.stage === "preparation" && execution.plan.length === 0 ? { snapshot, execution } : undefined;
}

/** Resume saved analysis after a planning failure or a legacy contradictory empty plan, never after a write attempt. */
export async function canResumePlanning(job: AutonomousJob): Promise<boolean> {
  if (!["failed", "partial"].includes(job.status) || job.authorization.actor !== job.author || job.authorization.policyVersion !== AUTONOMOUS_POLICY_VERSION || job.authorization.scope !== "create-review-drafts-and-revisions") return false;
  if (!await checkpoint(job.runId, "analysis-complete")) return false;
  const contradictory = await emptyContradictoryPlan(job.runId);
  if (!contradictory && (job.status !== "failed" || await checkpoint(job.runId, "decisions"))) return false;
  const repair = await checkpoint<{ attempts: number }>(job.runId, DECISION_REPAIR_KEY);
  if (repair && repair.attempts >= MAX_DECISION_ATTEMPTS) return false;
  const state = await db().prepare(`SELECT 1 FROM execution_plans WHERE run_id=? AND ?=0
    UNION ALL SELECT 1 FROM write_state WHERE run_id=?
    UNION ALL SELECT 1 FROM write_audit WHERE run_id=? LIMIT 1`).get(job.runId, contradictory ? 1 : 0, job.runId, job.runId);
  return !state;
}

export async function resumePlanning(runId: string, author: string) {
  await db().transaction(async () => {
    const job = await getJob(runId);
    if (!job || job.author !== author) throw new ApiError("Run not found", 404);
    if (!await canResumePlanning(job)) throw new ApiError("This run cannot resume planning. Inspect its recorded results before starting another run.", 409);
    const lock = await db().prepare("SELECT 1 FROM run_locks WHERE run_id=? AND heartbeat>?").get(runId, Date.now() - 60_000);
    if (lock) throw new ApiError("The previous request is still finishing. Try again shortly.", 409);
    const contradictory = await emptyContradictoryPlan(runId);
    if (contradictory) {
      // Archive the old choices in activity before removing only the unusable empty plan.
      await event(runId, "decisions", "validation", "Replan contradictory empty merges", "failed", { explanation: "Merged groups excluded all source proposals and generated no operations. The previous snapshot is preserved here; analysis is reused for a new decision.", output: contradictory });
      await db().prepare("DELETE FROM autonomous_checkpoints WHERE run_id=? AND key='decisions'").run(runId);
      await db().prepare("DELETE FROM execution_plans WHERE run_id=?").run(runId);
      await db().prepare("DELETE FROM studio_decisions WHERE run_id=?").run(runId);
      await db().prepare("DELETE FROM run_decisions WHERE run_id=?").run(runId);
    }
    await event(runId, "decisions", "state", "Resume planning from saved analysis", "started", { explanation: "The user resumed the interrupted run. Saved analysis is reused; no article writes have started.", input: { previousError: job.error } });
    const now = new Date().toISOString();
    await db().prepare("UPDATE autonomous_jobs SET status='queued',stage='decisions',error=NULL,lease_until=0,lease_token=NULL,updated_at=? WHERE run_id=?").run(now, runId);
    await db().prepare("UPDATE runs SET status='running',error=NULL,updated_at=? WHERE id=?").run(now, runId);
  })();
}
