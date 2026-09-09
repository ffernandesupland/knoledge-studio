import { randomUUID } from "node:crypto";
import { db } from "../db";
import type { OpResult, PreparedContent } from "./execute";

export interface WriteState {
  status: "prepared" | "review" | "writing" | "ok" | "error" | "uncertain";
  prepared?: PreparedContent;
  result?: OpResult;
}

export function getWriteState(key: string): WriteState | undefined {
  const row = db().prepare("SELECT status, prepared, result FROM write_state WHERE key=?").get(key) as { status: WriteState["status"]; prepared: string | null; result: string | null } | undefined;
  return row ? { status: row.status, prepared: row.prepared ? JSON.parse(row.prepared) : undefined, result: row.result ? JSON.parse(row.result) : undefined } : undefined;
}

export function saveWriteState(runId: string, key: string, state: WriteState) {
  db().prepare(`INSERT INTO write_state(key,run_id,status,prepared,result,updated_at) VALUES (?,?,?,?,?,?)
    ON CONFLICT(key) DO UPDATE SET status=excluded.status, prepared=excluded.prepared, result=excluded.result, updated_at=excluded.updated_at`)
    .run(key, runId, state.status, state.prepared ? JSON.stringify(state.prepared) : null, state.result ? JSON.stringify(state.result) : null, new Date().toISOString());
}

export function executionResults(runId: string): OpResult[] {
  return (db().prepare("SELECT result FROM write_state WHERE run_id=? AND result IS NOT NULL ORDER BY rowid").all(runId) as { result: string }[]).map((r) => JSON.parse(r.result));
}

/** Immutable once submission starts. Retries cannot silently change already-written work. */
export function freezeExecution<T>(runId: string, payload: T): T {
  db().prepare("INSERT INTO execution_plans(run_id,payload) VALUES (?,?) ON CONFLICT DO NOTHING").run(runId, JSON.stringify(payload));
  return loadExecution<T>(runId)!;
}
export function loadExecution<T>(runId: string): T | undefined {
  const row = db().prepare("SELECT payload FROM execution_plans WHERE run_id=?").get(runId) as { payload: string } | undefined;
  return row ? JSON.parse(row.payload) : undefined;
}

/** Cross-request/process lock; an expired worker's uncertain writes remain blocked separately. */
export async function withRunLock<T>(runId: string, fn: () => Promise<T>): Promise<T> {
  const token = randomUUID();
  const acquired = db().transaction(() => {
    db().prepare("DELETE FROM run_locks WHERE run_id=? AND heartbeat<?").run(runId, Date.now() - 15 * 60_000);
    return db().prepare("INSERT INTO run_locks(run_id,token,heartbeat) VALUES (?,?,?) ON CONFLICT DO NOTHING").run(runId, token, Date.now()).changes;
  })();
  if (!acquired) throw new Error("This run is already being submitted. Wait for it to finish before retrying.");
  const timer = setInterval(() => db().prepare("UPDATE run_locks SET heartbeat=? WHERE run_id=? AND token=?").run(Date.now(), runId, token), 10_000);
  try { return await fn(); }
  finally {
    clearInterval(timer);
    db().prepare("DELETE FROM run_locks WHERE run_id=? AND token=?").run(runId, token);
  }
}
