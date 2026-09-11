import { randomUUID } from "node:crypto";
import { db } from "../db";
import { ApiError } from "../api/auth";
import { AUTONOMOUS_POLICY_VERSION, type AutonomousEvent, type AutonomousInput, type AutonomousJob, type AutonomousStage, type AutonomousStatus } from "./types";

const LEASE_MS = 60_000;
const now = () => new Date().toISOString();
type Row = { run_id: string; author: string; input: string; authorization: string; status: AutonomousStatus; stage: AutonomousStage; created_at: string; updated_at: string; error: string | null };
const decode = (r: Row): AutonomousJob => ({ runId: r.run_id, author: r.author, input: JSON.parse(r.input), authorization: JSON.parse(r.authorization), status: r.status, stage: r.stage, createdAt: r.created_at, updatedAt: r.updated_at, error: r.error ?? undefined });
export async function getJob(id: string): Promise<AutonomousJob | undefined> {
  const row = await db().prepare("SELECT * FROM autonomous_jobs WHERE run_id=?").get(id) as Row | undefined;
  return row && decode(row);
}
export async function enqueue(id: string, author: string, input: AutonomousInput): Promise<AutonomousJob> {
  await db().transaction(async () => {
    const existing = await getJob(id);
    if (existing) {
      if (existing.author !== author || JSON.stringify(existing.input) !== JSON.stringify(input)) throw new ApiError("Request ID already used", 409);
      return;
    }
    const ts = now();
    const authorization = { actor: author, authorizedAt: ts, policyVersion: AUTONOMOUS_POLICY_VERSION, scope: "create-review-drafts-and-revisions" };
    await db().prepare("INSERT INTO runs(id,created_at,updated_at,author,path,status,input_text,source_ids,operations) VALUES (?,?,?,?,?,'running',?,?,?)")
      .run(id, ts, ts, author, input.path ?? null, input.text, JSON.stringify(input.sourceSolutionIds ?? []), JSON.stringify(input.operations));
    await db().prepare("INSERT INTO run_sources(run_id,payload) VALUES (?,?)").run(id, JSON.stringify(input.attachments ?? []));
    await db().prepare("INSERT INTO autonomous_jobs(run_id,author,input,authorization,created_at,updated_at) VALUES (?,?,?,?,?,?)").run(id, author, JSON.stringify(input), JSON.stringify(authorization), ts, ts);
    await event(id, "queued", "state", "Autonomous run authorized", "succeeded", { input: { authorization, selectedOptions: input.operations } });
  })();
  return (await getJob(id))!;
}
export async function event(runId: string, stage: AutonomousStage, kind: AutonomousEvent["kind"], name: string, status: AutonomousEvent["status"], data: { input?: unknown; output?: unknown; explanation?: string; correlationId?: string } = {}) {
  await db().prepare("INSERT INTO autonomous_events(run_id,ts,stage,kind,name,status,explanation,input,output,correlation_id) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(runId, now(), stage, kind, name, status, data.explanation ?? null, data.input === undefined ? null : JSON.stringify(data.input), data.output === undefined ? null : JSON.stringify(data.output), data.correlationId ?? null);
}
export async function events(runId: string, after = 0, limit = 200, includePayload = true): Promise<AutonomousEvent[]> {
  const rows = await db().prepare(`SELECT ${includePayload ? "*" : "id,run_id,ts,stage,kind,name,status,explanation,correlation_id"} FROM autonomous_events WHERE run_id=? AND id>? ORDER BY id LIMIT ?`).all(runId, after, limit) as { id: number; run_id: string; ts: string; stage: AutonomousStage; kind: AutonomousEvent["kind"]; name: string; status: AutonomousEvent["status"]; explanation: string | null; input: string | null; output: string | null; correlation_id: string | null }[];
  return rows.map(r => ({ id: r.id, runId: r.run_id, at: r.ts, stage: r.stage, kind: r.kind, name: r.name, status: r.status, explanation: r.explanation ?? undefined, input: r.input ? JSON.parse(r.input) : undefined, output: r.output ? JSON.parse(r.output) : undefined, correlationId: r.correlation_id ?? undefined }));
}
export async function checkpoint<T>(runId: string, key: string): Promise<T | undefined> {
  const r = await db().prepare("SELECT payload FROM autonomous_checkpoints WHERE run_id=? AND key=?").get(runId, key) as { payload: string } | undefined;
  return r ? JSON.parse(r.payload) : undefined;
}
export async function saveCheckpoint(runId: string, key: string, payload: unknown) {
  await db().prepare("INSERT INTO autonomous_checkpoints(run_id,key,payload,saved_at) VALUES (?,?,?,?) ON CONFLICT(run_id,key) DO UPDATE SET payload=excluded.payload,saved_at=excluded.saved_at").run(runId, key, JSON.stringify(payload), now());
}
export async function claim(runId?: string): Promise<{ job: AutonomousJob; token: string } | undefined> {
  return db().transaction(async () => {
    const row = await db().prepare("SELECT * FROM autonomous_jobs WHERE status IN ('queued','running') AND lease_until<? AND (? IS NULL OR run_id=?) ORDER BY created_at LIMIT 1").get(Date.now(), runId ?? null, runId ?? null) as Row | undefined;
    if (!row) return;
    const token = randomUUID();
    await db().prepare("UPDATE autonomous_jobs SET status='running',lease_token=?,lease_until=?,updated_at=? WHERE run_id=?").run(token, Date.now() + LEASE_MS, now(), row.run_id);
    await event(row.run_id, row.stage, "state", row.status === "queued" ? "App started autonomous run" : "App continued saved run", "started");
    return { job: { ...decode(row), status: "running" as const }, token };
  })();
}
export async function assertLease(runId: string, token: string) {
  const row = await db().prepare("SELECT run_id FROM autonomous_jobs WHERE run_id=? AND lease_token=? AND status='running' AND lease_until>?").get(runId, token, Date.now());
  if (!row) throw new Error("Autonomous execution lease lost; no further operations allowed");
}
export async function heartbeat(runId: string, token: string) {
  const r = await db().prepare("UPDATE autonomous_jobs SET lease_until=? WHERE run_id=? AND lease_token=? AND status='running' AND lease_until>?").run(Date.now() + LEASE_MS, runId, token, Date.now());
  if (!r.changes) throw new Error("Autonomous execution lease lost");
}
export async function stage(runId: string, token: string, value: AutonomousStage) {
  await assertLease(runId, token);
  await db().prepare("UPDATE autonomous_jobs SET stage=?,updated_at=? WHERE run_id=? AND lease_token=?").run(value, now(), runId, token);
}
export async function finish(runId: string, token: string, status: "completed" | "partial" | "failed", error?: string) {
  await db().transaction(async () => {
    await assertLease(runId, token);
    await event(runId, "finished", "state", "Run finished", status === "completed" ? "succeeded" : "failed", { explanation: error ?? status });
    await db().prepare("UPDATE autonomous_jobs SET stage='finished',status=?,error=?,updated_at=?,lease_until=0 WHERE run_id=? AND lease_token=?").run(status, error ?? null, now(), runId, token);
    await db().prepare("UPDATE runs SET status=?,error=?,updated_at=? WHERE id=?").run(status === "completed" ? "submitted" : status === "failed" ? "error" : "partial", error ?? null, now(), runId);
  })();
}
export async function latestJob(author: string) {
  const row = await db().prepare("SELECT * FROM autonomous_jobs WHERE author=? ORDER BY created_at DESC LIMIT 1").get(author) as Row | undefined;
  return row && decode(row);
}

export async function eventDetail(runId: string, id: number) {
  const page = await events(runId, id - 1, 1);
  return page[0]?.id === id ? page[0] : undefined;
}
export async function assertGuided(runId: string) {
  if (await getJob(runId)) throw new ApiError("Autonomous runs are controlled by their autonomous execution. Open the executed engine flow to inspect this run.", 409);
}


export async function release(runId: string, token: string) {
  await db().prepare("UPDATE autonomous_jobs SET lease_until=0,lease_token=NULL WHERE run_id=? AND lease_token=? AND status='running'").run(runId, token);
}
