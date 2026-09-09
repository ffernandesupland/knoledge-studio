import { db } from "../db";

export interface AuditEntry {
  ts: string;
  runId: string;
  user: string;
  op: string;
  idempotencyKey: string;
  target?: string;
  request: unknown;
  outcome: "ok" | "error";
  response?: string;
  error?: string;
}

/** Append-only record of every RightAnswers write. */
export function recordAudit(entry: AuditEntry): void {
  db()
    .prepare(
        `INSERT INTO write_audit (ts, run_id, user, op, idempotency_key, target, request, outcome, response, error)
         VALUES (@ts, @runId, @user, @op, @idempotencyKey, @target, @request, @outcome, @response, @error) ON CONFLICT DO NOTHING`,
      )
    .run({
        ts: entry.ts,
        runId: entry.runId,
        user: entry.user,
        op: entry.op,
        idempotencyKey: entry.idempotencyKey,
        target: entry.target ?? null,
        request: JSON.stringify(entry.request),
        outcome: entry.outcome,
        response: entry.response ?? null,
        error: entry.error ?? null,
    });
}

/**
 * True when this exact operation already completed. Retrying a partially-failed submit then
 * skips the writes that succeeded instead of duplicating them.
 */
export function alreadySucceeded(idempotencyKey: string): { target: string | null } | null {
  const row = db()
    .prepare(`SELECT target FROM write_audit WHERE idempotency_key=? AND outcome='ok' LIMIT 1`)
    .get(idempotencyKey) as { target: string | null } | undefined;
  return row ?? null;
}

export function auditForRun(runId: string) {
  return db()
    .prepare(
      `SELECT ts, op, idempotency_key, target, outcome, error
       FROM write_audit WHERE run_id=? ORDER BY id`,
    )
    .all(runId);
}
