import { AUTONOMOUS_SCHEMA } from "../autonomous/schema";
export const SCHEMA = `${AUTONOMOUS_SCHEMA}

CREATE TABLE IF NOT EXISTS source_images (
  id TEXT PRIMARY KEY, author TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL, bytes INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS source_image_chunks (
  image_id TEXT NOT NULL REFERENCES source_images(id) ON DELETE CASCADE,
  position INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY(image_id,position)
);
CREATE TABLE IF NOT EXISTS run_ground_context (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS run_source_documents (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, payload TEXT NOT NULL);

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
CREATE TABLE IF NOT EXISTS metadata_research (
  run_id TEXT NOT NULL REFERENCES runs(id), candidate_key TEXT NOT NULL, identity TEXT NOT NULL, report TEXT NOT NULL,
  PRIMARY KEY (run_id,candidate_key)
);
CREATE TABLE IF NOT EXISTS reference_checks (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS draft_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  saved_at TEXT NOT NULL, payload TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, phase TEXT NOT NULL,
  ts TEXT NOT NULL, operation TEXT NOT NULL, model TEXT NOT NULL,
  input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL,
  prompt_version TEXT NOT NULL, request TEXT NOT NULL, response TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ra_connections (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  bearer_token TEXT NOT NULL,
  ra_user TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner, name)
);
CREATE TABLE IF NOT EXISTS ra_connection_defaults (
  owner TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ra_connection_settings (
  connection_id TEXT PRIMARY KEY REFERENCES ra_connections(id) ON DELETE CASCADE,
  company_code TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_ra_connections (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  connection_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS solution_launches (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  solution_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_solution_launches_author ON solution_launches(author, created_at DESC);
CREATE TABLE IF NOT EXISTS solution_launch_contexts (
  launch_id TEXT PRIMARY KEY REFERENCES solution_launches(id) ON DELETE CASCADE,
  source_solution_ids TEXT NOT NULL,
  operations TEXT NOT NULL,
  duplicate_scope_ids TEXT NOT NULL
);

-- A customer-defined review is an analytic objective, never an executable pipeline action.
CREATE TABLE IF NOT EXISTS solution_review_definitions (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  name TEXT NOT NULL,
  objective TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_solution_review_definitions_owner
  ON solution_review_definitions(author, connection_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS solution_reviews (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  solution_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  definition_id TEXT NOT NULL REFERENCES solution_review_definitions(id) ON DELETE RESTRICT,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_solution_reviews_source
  ON solution_reviews(author, connection_id, solution_id, created_at DESC);

CREATE TABLE IF NOT EXISTS solution_review_handoffs (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  solution_id TEXT NOT NULL,
  source_version TEXT NOT NULL,
  review_id TEXT NOT NULL REFERENCES solution_reviews(id) ON DELETE CASCADE,
  selected_finding_indexes TEXT NOT NULL,
  native_operations TEXT NOT NULL,
  review_objectives TEXT NOT NULL,
  created_at TEXT NOT NULL,
  consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_solution_review_handoffs_author
  ON solution_review_handoffs(author, created_at DESC);
CREATE TABLE IF NOT EXISTS solution_review_handoff_reviews (
  handoff_id TEXT NOT NULL REFERENCES solution_review_handoffs(id) ON DELETE CASCADE,
  review_id TEXT NOT NULL REFERENCES solution_reviews(id) ON DELETE CASCADE,
  PRIMARY KEY (handoff_id, review_id)
);
CREATE TABLE IF NOT EXISTS run_solution_review_handoffs (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  handoff_id TEXT NOT NULL REFERENCES solution_review_handoffs(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS solution_review_handoff_resolutions (
  handoff_id TEXT NOT NULL REFERENCES solution_review_handoffs(id) ON DELETE CASCADE,
  question_key TEXT NOT NULL,
  choice TEXT NOT NULL,
  final_information TEXT NOT NULL,
  answered_at TEXT NOT NULL,
  PRIMARY KEY (handoff_id, question_key)
);

`;

