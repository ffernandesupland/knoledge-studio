/** Additive tables only. Existing guided runs and approval records are unchanged. */
export const AUTONOMOUS_SCHEMA = `
CREATE TABLE IF NOT EXISTS autonomous_jobs (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  author TEXT NOT NULL,
  input TEXT NOT NULL,
  authorization TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  stage TEXT NOT NULL DEFAULT 'queued',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_autonomous_queue ON autonomous_jobs(status, lease_until, created_at);
CREATE TABLE IF NOT EXISTS autonomous_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES autonomous_jobs(run_id),
  ts TEXT NOT NULL,
  stage TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  explanation TEXT,
  input TEXT,
  output TEXT,
  correlation_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_autonomous_events_run ON autonomous_events(run_id, id);
CREATE TABLE IF NOT EXISTS autonomous_checkpoints (
  run_id TEXT NOT NULL REFERENCES autonomous_jobs(run_id),
  key TEXT NOT NULL,
  payload TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY(run_id, key)
);
`;

export const WORKER_SCHEMA = `CREATE TABLE IF NOT EXISTS autonomous_workers (id TEXT PRIMARY KEY, heartbeat INTEGER NOT NULL);`;
