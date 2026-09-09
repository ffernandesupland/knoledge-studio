import type { Operation } from "../ks/data";
export interface DecisionSnapshot {
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
  attachments?: { label: string; text: string; kind?: "file" | "url" }[];
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

export function createRun(args: {
  id: string;
  author: string;
  path: string | null;
  inputText: string;
  attachments?: { label: string; text: string; kind?: "file" | "url" }[];
  sourceIds: string[];
  operations: string[];
}): void {
  db()
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
    });
  db().prepare("INSERT INTO run_sources(run_id,payload) VALUES (?,?)").run(args.id, JSON.stringify(args.attachments ?? []));
}

export function completeRun(
  id: string,
  view: { candidates: ViewCandidate[]; groups: ViewDupeGroup[]; costUsd: number; steps: RunOutput["steps"] },
): void {
  db()
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
    });

  // Everything a run produces starts selected, so a restored run matches a fresh one.
  db()
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
    });
}

export function failRun(id: string, error: string): void {
  db()
    .prepare(`UPDATE runs SET status='error', updated_at=@ts, error=@error WHERE id=@id`)
    .run({ id, ts: now(), error });
}

export function markSubmitted(id: string): void {
  db().prepare(`UPDATE runs SET status='submitted', updated_at=@ts WHERE id=@id`).run({ id, ts: now() });
}

export function saveDecisions(
  runId: string,
  decisions: {
    selectedKeys: string[];
    resolutions: DupeResolution[];
    collection?: string | null;
    language?: string | null;
  },
): void {
  db()
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
    });
}

function hydrate(row: RunRow, decision?: DecisionRow): StoredRun {
  return {
    id: row.id,
    formatVersion: db().prepare("SELECT 1 FROM run_sources WHERE run_id=?").get(row.id) ? 2 : 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    author: row.author,
    path: row.path,
    status: row.status as RunStatus,
    inputText: row.input_text ?? "",
    attachments: JSON.parse((db().prepare("SELECT payload FROM run_sources WHERE run_id=?").get(row.id) as { payload: string } | undefined)?.payload ?? "[]"),
    sourceIds: JSON.parse(row.source_ids),
    operations: JSON.parse(row.operations),
    costUsd: row.cost_usd,
    candidates: JSON.parse(row.candidates),
    groups: JSON.parse(row.groups_json),
    steps: JSON.parse(row.steps),
    error: row.error,
    snapshot: readSnapshot(row.id),
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

export function getRun(id: string): StoredRun | null {
  const row = db().prepare(`SELECT * FROM runs WHERE id=?`).get(id) as RunRow | undefined;
  if (!row) return null;
  const decision = db()
    .prepare(`SELECT * FROM run_decisions WHERE run_id=?`)
    .get(id) as DecisionRow | undefined;
  return hydrate(row, decision);
}

/** "Start over": drops the resumable run so a reload does not bring the discarded content back. */
export function discardResumableRun(author: string): void {
  db()
    .prepare(`UPDATE runs SET status='discarded', updated_at=@ts WHERE author=@author AND status IN ('done','partial')`)
    .run({ author, ts: now() });
}

/** Most recent run that still has work left, so a refresh lands the author back where they were. */
export function getResumableRun(author: string): StoredRun | null {
  const row = db()
    .prepare(
      `SELECT * FROM runs WHERE author=? AND status IN ('done','partial') ORDER BY updated_at DESC LIMIT 1`,
    )
    .get(author) as RunRow | undefined;
  if (!row) return null;
  const decision = db()
    .prepare(`SELECT * FROM run_decisions WHERE run_id=?`)
    .get(row.id) as DecisionRow | undefined;
  return hydrate(row, decision);
}

export function listRuns(limit = 20): Pick<StoredRun, "id" | "createdAt" | "status" | "costUsd">[] {
  const rows = db()
    .prepare(`SELECT id, created_at, status, cost_usd FROM runs ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as { id: string; created_at: string; status: string; cost_usd: number }[];
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    status: r.status as RunStatus,
    costUsd: r.cost_usd,
  }));
}

export function readSnapshot(id: string): DecisionSnapshot | undefined {
  const row = db().prepare("SELECT snapshot FROM studio_decisions WHERE run_id=?").get(id) as { snapshot: string } | undefined;
  return row ? JSON.parse(row.snapshot) : undefined;
}
export function saveSnapshot(id: string, snapshot: DecisionSnapshot) {
  db().prepare("INSERT INTO studio_decisions(run_id,snapshot) VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET snapshot=excluded.snapshot").run(id, JSON.stringify(snapshot));
  saveDecisions(id, snapshot);
}
export function markPartial(id: string) {
  db().prepare("UPDATE runs SET status='partial', updated_at=? WHERE id=?").run(now(), id);
}
