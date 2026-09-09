import Database from "better-sqlite3";
import path from "node:path";
import { mkdirSync } from "node:fs";

/**
 * SQLite rather than Postgres for the pilot: the architecture's original reason for Postgres
 * was pgvector, and the embedding index was dropped when dedupe moved to search-and-adjudicate.
 * What is left is ordinary relational state, so a file-backed database avoids standing up
 * infrastructure. The repository layer is the seam if this needs to become Postgres later.
 */

const DATA_DIR = path.join(process.cwd(), ".data");

let instance: Database.Database | null = null;

/** Points the store at a different file; used by tests to avoid touching the dev database. */
export function useDatabase(file: string): void {
  instance?.close();
  instance = null;
  process.env.KS_DB_PATH = file;
}

export function closeDatabase(): void {
  instance?.close();
  instance = null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id            TEXT PRIMARY KEY,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  author        TEXT NOT NULL,
  path          TEXT,
  status        TEXT NOT NULL,
  input_text    TEXT,
  source_ids    TEXT NOT NULL DEFAULT '[]',
  operations    TEXT NOT NULL DEFAULT '[]',
  cost_usd      REAL NOT NULL DEFAULT 0,
  candidates    TEXT NOT NULL DEFAULT '[]',
  groups_json   TEXT NOT NULL DEFAULT '[]',
  steps         TEXT NOT NULL DEFAULT '[]',
  error         TEXT
);

CREATE TABLE IF NOT EXISTS run_decisions (
  run_id        TEXT NOT NULL,
  selected_keys TEXT NOT NULL DEFAULT '[]',
  resolutions   TEXT NOT NULL DEFAULT '[]',
  collection    TEXT,
  language      TEXT,
  updated_at    TEXT NOT NULL,
  PRIMARY KEY (run_id),
  FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS write_audit (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  ts              TEXT NOT NULL,
  run_id          TEXT NOT NULL,
  user            TEXT NOT NULL,
  op              TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  target          TEXT,
  request         TEXT NOT NULL,
  outcome         TEXT NOT NULL,
  response        TEXT,
  error           TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_run ON write_audit(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_idem ON write_audit(idempotency_key, outcome)
  WHERE outcome = 'ok';
CREATE INDEX IF NOT EXISTS idx_runs_updated ON runs(updated_at DESC);
CREATE TABLE IF NOT EXISTS run_sources (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS studio_decisions (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  snapshot TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_executions (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  saved_at TEXT NOT NULL,
  payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS execution_plans (
  run_id TEXT PRIMARY KEY REFERENCES runs(id), payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_locks (
  run_id TEXT PRIMARY KEY, token TEXT NOT NULL, heartbeat INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS write_state (
  key TEXT PRIMARY KEY, run_id TEXT NOT NULL,
  status TEXT NOT NULL, prepared TEXT, result TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, phase TEXT NOT NULL,
  ts TEXT NOT NULL, operation TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL,
  prompt_version TEXT NOT NULL, request TEXT NOT NULL, response TEXT NOT NULL
);

`;

export function db(): Database.Database {
  if (instance) return instance;
  const file = process.env.KS_DB_PATH ?? path.join(DATA_DIR, "knowledge-studio.db");
  mkdirSync(path.dirname(file), { recursive: true });
  const conn = new Database(file);
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(SCHEMA);
  instance = conn;
  return conn;
}
