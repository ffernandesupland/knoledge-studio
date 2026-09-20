/** Durable, application-owned state for the AI Workspace. */
export const AGENT_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_threads (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  title TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_threads_owner_updated ON agent_threads(owner, updated_at DESC);

CREATE TABLE IF NOT EXISTS agent_messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agent_messages_thread_created ON agent_messages(thread_id, created_at);

CREATE TABLE IF NOT EXISTS agent_message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL REFERENCES agent_messages(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('pdf','docx','text','image')),
  image_id TEXT,
  meta TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_agent_message_attachments_message ON agent_message_attachments(message_id);

CREATE TABLE IF NOT EXISTS agent_uploaded_files (
  id TEXT PRIMARY KEY,
  owner TEXT NOT NULL,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS agent_uploaded_file_chunks (
  file_id TEXT NOT NULL REFERENCES agent_uploaded_files(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  data BLOB NOT NULL,
  PRIMARY KEY(file_id,position)
);
CREATE TABLE IF NOT EXISTS agent_attachment_files (
  attachment_id TEXT PRIMARY KEY REFERENCES agent_message_attachments(id) ON DELETE CASCADE,
  uploaded_file_id TEXT NOT NULL REFERENCES agent_uploaded_files(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS agent_context_items (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  solution_id TEXT NOT NULL,
  title TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('reference','target','standard')),
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(thread_id, solution_id)
);

CREATE TABLE IF NOT EXISTS agent_events (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES agent_threads(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;
