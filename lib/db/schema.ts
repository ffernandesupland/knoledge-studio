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
CREATE TABLE IF NOT EXISTS run_demand_specifications (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS run_options (run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE, payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS configuration_profiles (
  id TEXT PRIMARY KEY,
  -- The environment connection is virtual and has no ra_connections row.
  connection_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('content_standard', 'ground_truth')),
  name TEXT NOT NULL,
  scope_collection TEXT,
  scope_taxonomy TEXT,
  scope_collections TEXT,
  scope_taxonomies TEXT,
  scope_operator TEXT NOT NULL DEFAULT 'and' CHECK (scope_operator IN ('and', 'or')),
  is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  guidance TEXT NOT NULL DEFAULT '',
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (is_default = 0 OR (scope_collection IS NULL AND scope_taxonomy IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_configuration_profiles_default
  ON configuration_profiles(connection_id, kind) WHERE is_default = 1 AND status = 'active';
CREATE TABLE IF NOT EXISTS configuration_documents (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  extracted_text TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS configuration_document_chunks (
  document_id TEXT NOT NULL REFERENCES configuration_documents(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY(document_id, position)
);
CREATE TABLE IF NOT EXISTS configuration_profile_sources (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES configuration_profiles(id) ON DELETE CASCADE,
  source_type TEXT NOT NULL CHECK (source_type IN ('text', 'document', 'solution')),
  text_content TEXT,
  document_id TEXT REFERENCES configuration_documents(id) ON DELETE RESTRICT,
  solution_id TEXT,
  position INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  CHECK (
    (source_type = 'text' AND text_content IS NOT NULL AND document_id IS NULL AND solution_id IS NULL) OR
    (source_type = 'document' AND text_content IS NULL AND document_id IS NOT NULL AND solution_id IS NULL) OR
    (source_type = 'solution' AND text_content IS NULL AND document_id IS NULL AND solution_id IS NOT NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_configuration_profile_source_position ON configuration_profile_sources(profile_id, position);
CREATE TABLE IF NOT EXISTS configuration_snippets (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  scope_collection TEXT,
  scope_taxonomy TEXT,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS run_configuration_snapshots (
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('content_standards', 'ground_truth', 'snippets')),
  payload TEXT NOT NULL,
  PRIMARY KEY(run_id, kind)
);
CREATE TABLE IF NOT EXISTS demand_recommendations (
  id TEXT PRIMARY KEY,
  author TEXT NOT NULL,
  requirement_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  payload TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_demand_recommendations_author ON demand_recommendations(author, created_at DESC);
CREATE TABLE IF NOT EXISTS run_demand_recommendations (
  run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
  recommendation_id TEXT NOT NULL REFERENCES demand_recommendations(id) ON DELETE RESTRICT
);

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

-- Evals are an internal measurement layer. They are intentionally separate from
-- write_state and write_audit, so a score can never block an authoring or publishing flow.
CREATE TABLE IF NOT EXISTS eval_rubrics (
  id TEXT PRIMARY KEY,
  signature TEXT NOT NULL UNIQUE,
  scenario_label TEXT NOT NULL,
  pipeline_json TEXT NOT NULL,
  rubric_json TEXT NOT NULL,
  compiler_model TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS eval_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  prepared_version TEXT NOT NULL,
  rubric_id TEXT NOT NULL REFERENCES eval_rubrics(id) ON DELETE RESTRICT,
  judge_model TEXT NOT NULL,
  result_json TEXT NOT NULL,
  score REAL NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(run_id, idempotency_key, prepared_version, rubric_id)
);
CREATE INDEX IF NOT EXISTS idx_eval_results_rubric_created ON eval_results(rubric_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_eval_results_run ON eval_results(run_id, idempotency_key);

`;

