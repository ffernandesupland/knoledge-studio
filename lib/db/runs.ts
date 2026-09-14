import type { SourceAttachment, SourceBlock } from "@/lib/ks/source-document";
import type { Operation } from "../ks/data";
export interface DecisionSnapshot {
  metadata?: import("../metadata/settings").MetadataSettings;
  candidates: ViewCandidate[];
  groups: ViewDupeGroup[];
  selectedKeys: string[];
  resolutions: DupeResolution[];
  operations: Operation[];
  collection: string;
  language: string;
  standard: string;
  standardsRules: string[];
  newSolutionTemplate: string | null;
  templateOverrides: string[];
}
import { db } from "./index";
import type { ViewCandidate, ViewDupeGroup } from "../ks/model";
import type { DupeResolution } from "../ks/helpers";
import type { RunOutput } from "../pipeline/run";

export type RunStatus = "running" | "done" | "error" | "submitted" | "partial" | "discarded";

export interface StoredRun {
  id: string;
  formatVersion?: number;
  createdAt: string;
  updatedAt: string;
  author: string;
  path: string | null;
  status: RunStatus;
  inputText: string;
  attachments?: SourceAttachment[];
  content?: SourceBlock[];
  sourceIds: string[];
  operations: string[];
  costUsd: number;
  candidates: ViewCandidate[];
  groups: ViewDupeGroup[];
  steps: RunOutput["steps"];
  error: string | null;
  snapshot?: DecisionSnapshot;
  decisions: {
    selectedKeys: string[];
    resolutions: DupeResolution[];
    collection: string | null;
    language: string | null;
  } | null;
}

interface RunRow {
  id: string;
  created_at: string;
  updated_at: string;
  author: string;
  path: string | null;
  status: string;
  input_text: string | null;
  source_ids: string;
  operations: string;
  cost_usd: number;
  candidates: string;
  groups_json: string;
  steps: string;
  error: string | null;
}

interface DecisionRow {
  selected_keys: string;
  resolutions: string;
  collection: string | null;
  language: string | null;
}

const now = () => new Date().toISOString();

export async function createRun(args: {
  id: string;
  author: string;
  path: string | null;
  inputText: string;
  attachments?: SourceAttachment[];
  content?: SourceBlock[];
  sourceIds: string[];
  operations: string[];
}): Promise<void> {
  await db().transaction(async () => {
    (await db()
      .prepare(
        `INSERT INTO runs (id, created_at, updated_at, author, path, status, input_text, source_ids, operations)
         VALUES (@id, @ts, @ts, @author, @path, 'running', @inputText, @sourceIds, @operations)`,
      )
      .run({
        id: args.id,
        ts: now(),
        author: args.author,
        path: args.path,
        inputText: args.inputText,
        sourceIds: JSON.stringify(args.sourceIds),
        operations: JSON.stringify(args.operations),
      }));
    (await db().prepare("INSERT INTO run_sources(run_id,payload) VALUES (?,?)").run(args.id, JSON.stringify(args.attachments ?? [])));
    if (args.content) await db().prepare("INSERT INTO run_source_documents(run_id,payload) VALUES (?,?)").run(args.id, JSON.stringify(args.content));
  })();
}

export async function completeRun(
  id: string,
  view: { candidates: ViewCandidate[]; groups: ViewDupeGroup[]; costUsd: number; steps: RunOutput["steps"] },
): Promise<void> {
  await db().transaction(async () => {
    (await db()
      .prepare(
        `UPDATE runs SET status='done', updated_at=@ts, cost_usd=@cost,
                candidates=@candidates, groups_json=@groups, steps=@steps WHERE id=@id`,
      )
      .run({
        id,
        ts: now(),
        cost: view.costUsd,
        candidates: JSON.stringify(view.candidates),
        groups: JSON.stringify(view.groups),
        steps: JSON.stringify(view.steps),
      }));

    // Everything a run produces starts selected, so a restored run matches a fresh one.
    (await db()
      .prepare(
        `INSERT INTO run_decisions (run_id, selected_keys, resolutions, updated_at)
         VALUES (@id, @keys, @resolutions, @ts)
         ON CONFLICT(run_id) DO NOTHING`,
      )
      .run({
        id,
        ts: now(),
        keys: JSON.stringify(view.candidates.filter((c) => !c.researchOnly).map((c) => c.key)),
        resolutions: JSON.stringify(view.groups.map(() => null)),
      }));
  })();
}

export async function failRun(id: string, error: string): Promise<void> {
  (await db()
    .prepare(`UPDATE runs SET status='error', updated_at=@ts, error=@error WHERE id=@id`)
    .run({ id, ts: now(), error }));
}

export async function markSubmitted(id: string): Promise<void> {
  (await db().prepare(`UPDATE runs SET status='submitted', updated_at=@ts WHERE id=@id`).run({ id, ts: now() }));
}

export async function saveDecisions(
  runId: string,
  decisions: {
    selectedKeys: string[];
    resolutions: DupeResolution[];
    collection?: string | null;
    language?: string | null;
  },
): Promise<void> {
  (await db()
    .prepare(
      `INSERT INTO run_decisions (run_id, selected_keys, resolutions, collection, language, updated_at)
       VALUES (@runId, @keys, @resolutions, @collection, @language, @ts)
       ON CONFLICT(run_id) DO UPDATE SET
         selected_keys=@keys, resolutions=@resolutions,
         collection=@collection, language=@language, updated_at=@ts`,
    )
    .run({
      runId,
      ts: now(),
      keys: JSON.stringify(decisions.selectedKeys),
      resolutions: JSON.stringify(decisions.resolutions),
      collection: decisions.collection ?? null,
      language: decisions.language ?? null,
    }));
}

async function hydrate(row: RunRow, decision?: DecisionRow): Promise<StoredRun> {
  return {
    id: row.id,
    formatVersion: (await db().prepare("SELECT 1 FROM run_sources WHERE run_id=?").get(row.id)) ? 2 : 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: row.author,
    path: row.path,
    status: row.status as RunStatus,
    inputText: row.input_text ?? "",
    attachments: JSON.parse(((await db().prepare("SELECT payload FROM run_sources WHERE run_id=?").get(row.id)) as { payload: string } | undefined)?.payload ?? "[]"),
    content: JSON.parse(((await db().prepare("SELECT payload FROM run_source_documents WHERE run_id=?").get(row.id)) as { payload: string } | undefined)?.payload ?? "null") ?? undefined,
    sourceIds: JSON.parse(row.source_ids),
    operations: JSON.parse(row.operations),
    costUsd: row.cost_usd,
    candidates: JSON.parse(row.candidates),
    groups: JSON.parse(row.groups_json),
    steps: JSON.parse(row.steps),
    error: row.error,
    snapshot: (await readSnapshot(row.id)),
    decisions: decision
      ? {
          selectedKeys: JSON.parse(decision.selected_keys),
          resolutions: JSON.parse(decision.resolutions),
          collection: decision.collection,
          language: decision.language,
        }
      : null,
  };
}

export async function getRun(id: string): Promise<StoredRun | null> {
  const row = (await db().prepare(`SELECT * FROM runs WHERE id=?`).get(id)) as RunRow | undefined;
  if (!row) return null;
  const decision = (await db()
    .prepare(`SELECT * FROM run_decisions WHERE run_id=?`)
    .get(id)) as DecisionRow | undefined;
  return (await hydrate(row, decision));
}

/** "Start over": drops the resumable run so a reload does not bring the discarded content back. */
export async function discardResumableRun(author: string): Promise<void> {
  (await db()
    .prepare(`UPDATE runs SET status='discarded', updated_at=@ts WHERE author=@author AND status IN ('done','partial') AND NOT EXISTS (SELECT 1 FROM autonomous_jobs WHERE run_id=runs.id)`)
    .run({ author, ts: now() }));
}

/** Most recent run that still has work left, so a refresh lands the author back where they were. */
export async function getResumableRun(author: string): Promise<StoredRun | null> {
  const row = (await db()
    .prepare(
      `SELECT * FROM runs WHERE author=? AND status IN ('done','partial') AND NOT EXISTS (SELECT 1 FROM autonomous_jobs WHERE run_id=runs.id) ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(author)) as RunRow | undefined;
  if (!row) return null;
  const decision = (await db()
    .prepare(`SELECT * FROM run_decisions WHERE run_id=?`)
    .get(row.id)) as DecisionRow | undefined;
  return (await hydrate(row, decision));
}

export async function listRuns(limit = 20): Promise<Pick<StoredRun, "id" | "createdAt" | "status" | "costUsd">[]> {
  const rows = (await db()
    .prepare(`SELECT id, created_at, status, cost_usd FROM runs ORDER BY created_at DESC LIMIT ?`)
    .all(limit)) as { id: string; created_at: string; status: string; cost_usd: number }[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    status: r.status as RunStatus,
    costUsd: r.cost_usd,
  }));
}

export async function readSnapshot(id: string): Promise<DecisionSnapshot | undefined> {
  const row = (await db().prepare("SELECT snapshot FROM studio_decisions WHERE run_id=?").get(id)) as { snapshot: string } | undefined;
  return row ? JSON.parse(row.snapshot) : undefined;
}
export async function saveSnapshot(id: string, snapshot: DecisionSnapshot) {
  await db().transaction(async () => {
    (await db().prepare("INSERT INTO studio_decisions(run_id,snapshot) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET snapshot=excluded.snapshot").run(id, JSON.stringify(snapshot)));
    (await saveDecisions(id, snapshot));
  })();
}
export async function markPartial(id: string) {
  (await db().prepare("UPDATE runs SET status='partial', updated_at=? WHERE id=?").run(now(), id));
}
