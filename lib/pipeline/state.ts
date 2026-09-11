import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { OpResult, PreparedContent } from "./execute";

export interface WriteState {
  status: "prepared" | "review" | "writing" | "ok" | "error" | "uncertain";
  prepared?: PreparedContent;
  result?: OpResult;
}

export async function getWriteState(key: string): Promise<WriteState | undefined> {
  const row = (await db().prepare("SELECT status, prepared, result FROM write_state WHERE key=?").get(key)) as { status: WriteState["status"]; prepared: string | null; result: string | null } | undefined;
  return row ? { status: row.status, prepared: row.prepared ? JSON.parse(row.prepared) : undefined, result: row.result ? JSON.parse(row.result) : undefined } : undefined;
}

export async function saveWriteState(runId: string, key: string, state: WriteState) {
  (await db().prepare(`INSERT INTO write_state(key,run_id,status,prepared,result,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET status=excluded.status, prepared=excluded.prepared, result=excluded.result, updated_at=excluded.updated_at`)
    .run(key, runId, state.status, state.prepared ? JSON.stringify(state.prepared) : null, state.result ? JSON.stringify(state.result) : null, new Date().toISOString()));
}

export async function executionResults(runId: string): Promise<OpResult[]> {
  return ((await db().prepare("SELECT result FROM write_state WHERE run_id=? AND result IS NOT NULL ORDER BY rowid").all(runId)) as { result: string }[]).map((r) => JSON.parse(r.result));
}

/** Immutable once submission starts. Retries cannot silently change already-written work. */
export async function freezeExecution<T>(runId: string, payload: T): Promise<T> {
  (await db().prepare("INSERT INTO execution_plans(run_id,payload) VALUES (?,?) ON CONFLICT DO NOTHING").run(runId, JSON.stringify(payload)));
  return (await loadExecution<T>(runId))!;
}
export async function loadExecution<T>(runId: string): Promise<T | undefined> {
  const row = (await db().prepare("SELECT payload FROM execution_plans WHERE run_id=?").get(runId)) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : undefined;
}

/** Cross-request/process lock; an expired worker's uncertain writes remain blocked separately. */
export async function withRunLock<T>(runId: string, fn: () => Promise<T>, leaseMs = 15 * 60_000): Promise<T> {
  const token = randomUUID();
  const acquired = (await db().transaction(async () => {
    (await db().prepare("DELETE FROM run_locks WHERE run_id=? AND heartbeat<?").run(runId, Date.now() - leaseMs));
    return (await db().prepare("INSERT INTO run_locks(run_id,token,heartbeat) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(runId, token, Date.now())).changes;
  })());
  if (!acquired) throw new Error("This run is already being processed. Wait for it to finish before retrying.");
  const timer = setInterval(() => {
    void db().prepare("UPDATE run_locks SET heartbeat=? WHERE run_id=? AND token=?").run(Date.now(), runId, token).catch(() => {
      console.error("Could not renew submission lock", runId);
    });
  }, 10_000);
  try { return await fn(); }
  finally {
    clearInterval(timer);
    (await db().prepare("DELETE FROM run_locks WHERE run_id=? AND token=?").run(runId, token));
  }
}

/** Caller holds the run lock. Preparation can change until submission is frozen. */
export async function savePreparationPlan<T extends { stage?: string; reviewIdentity?: string }>(runId: string, payload: T): Promise<T> {
  return db().transaction(async () => {
    const existing = await loadExecution<T>(runId);
    if (existing && existing.stage !== "preparation") {
      if (existing.reviewIdentity && existing.reviewIdentity !== payload.reviewIdentity) throw new Error("Submission has started. Start a new run for a different plan.");
      return existing;
    }
    if (existing && existing.reviewIdentity !== payload.reviewIdentity) {
      const written = await db().prepare("SELECT key FROM write_state WHERE run_id=? AND status IN ('writing','ok','uncertain') LIMIT 1").get(runId);
      if (written) throw new Error("This run has write attempts and cannot change its plan.");
      await db().prepare("DELETE FROM write_state WHERE run_id=?").run(runId);
    }
    await db().prepare("INSERT INTO execution_plans(run_id,payload) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET payload=excluded.payload").run(runId, JSON.stringify(payload));
    return payload;
  })();
}

export async function freezePreparedPlan<T extends { stage?: string }>(runId: string, payload: T): Promise<T> {
  const frozen = { ...payload, stage: "submission" };
  await db().prepare("UPDATE execution_plans SET payload=? WHERE run_id=?").run(JSON.stringify(frozen), runId);
  return frozen;
}
