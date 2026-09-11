import { db } from "../db";
import { ApiError } from "../api/auth";
import { checkpoint, event, getJob } from "./store";
import { AUTONOMOUS_POLICY_VERSION, type AutonomousJob } from "./types";

/** Only pre-decision failures with saved analysis and no write state can resume. */
export async function canResumePlanning(job: AutonomousJob): Promise<boolean> {
  if (job.status !== "failed" || job.authorization.actor !== job.author || job.authorization.policyVersion !== AUTONOMOUS_POLICY_VERSION || job.authorization.scope !== "create-review-drafts-and-revisions") return false;
  if (!await checkpoint(job.runId, "analysis-complete") || await checkpoint(job.runId, "decisions")) return false;
  const state = await db().prepare(`SELECT 1 FROM execution_plans WHERE run_id=?
    UNION ALL SELECT 1 FROM write_state WHERE run_id=?
    UNION ALL SELECT 1 FROM write_audit WHERE run_id=? LIMIT 1`).get(job.runId, job.runId, job.runId);
  return !state;
}

export async function resumePlanning(runId: string, author: string) {
  await db().transaction(async () => {
    const job = await getJob(runId);
    if (!job || job.author !== author) throw new ApiError("Run not found", 404);
    if (!await canResumePlanning(job)) throw new ApiError("This run cannot resume planning. Inspect its recorded results before starting another run.", 409);
    const lock = await db().prepare("SELECT 1 FROM run_locks WHERE run_id=? AND heartbeat>?").get(runId, Date.now() - 60_000);
    if (lock) throw new ApiError("The previous request is still finishing. Try again shortly.", 409);
    await event(runId, "decisions", "state", "Resume planning from saved analysis", "started", { explanation: "The user resumed the interrupted run. Saved analysis is reused; no article writes have started.", input: { previousError: job.error } });
    const now = new Date().toISOString();
    await db().prepare("UPDATE autonomous_jobs SET status='queued',stage='decisions',error=NULL,lease_until=0,lease_token=NULL,updated_at=? WHERE run_id=?").run(now, runId);
    await db().prepare("UPDATE runs SET status='running',error=NULL,updated_at=? WHERE id=?").run(now, runId);
  })();
}
