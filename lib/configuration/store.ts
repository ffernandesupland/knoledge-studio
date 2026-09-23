import { randomUUID } from "node:crypto";
import { db } from "../db";
import { findScopeConflicts } from "./resolver";
import { configurationProfileDraftSchema, type ConfigurationProfile, type ConfigurationProfileDraft, type ConfigurationProfileKind, type ConfigurationProfileStatus, type ConfigurationSource } from "./types";

type ProfileRow = {
  id: string;
  connection_id: string;
  kind: ConfigurationProfileKind;
  name: string;
  scope_collection: string | null;
  scope_taxonomy: string | null;
  is_default: number;
  status: ConfigurationProfileStatus;
  guidance: string;
  revision: number;
  created_at: string;
  updated_at: string;
};
type SourceRow = { source_type: ConfigurationSource["type"]; text_content: string | null; document_id: string | null; document_name: string | null; solution_id: string | null };

const now = () => new Date().toISOString();

export class ConfigurationScopeConflictError extends Error {
  constructor(names: string[]) {
    super(`An active configuration already uses this scope: ${names.join(", ")}. Archive or narrow the existing configuration first.`);
    this.name = "ConfigurationScopeConflictError";
  }
}

function sourceFromRow(row: SourceRow): ConfigurationSource {
  if (row.source_type === "text" && row.text_content != null) return { type: "text", text: row.text_content };
  if (row.source_type === "document" && row.document_id) return { type: "document", documentId: row.document_id, ...(row.document_name ? { label: row.document_name } : {}) };
  if (row.source_type === "solution" && row.solution_id) return { type: "solution", solutionId: row.solution_id };
  throw new Error("Stored configuration source is invalid.");
}

async function sourcesForProfile(profileId: string): Promise<ConfigurationSource[]> {
  const rows = await db().prepare("SELECT s.source_type, s.text_content, s.document_id, d.name AS document_name, s.solution_id FROM configuration_profile_sources s LEFT JOIN configuration_documents d ON d.id=s.document_id WHERE s.profile_id=? ORDER BY s.position").all(profileId) as SourceRow[];
  return rows.map(sourceFromRow);
}

async function profileFromRow(row: ProfileRow): Promise<ConfigurationProfile> {
  return {
    id: row.id,
    connectionId: row.connection_id,
    kind: row.kind,
    name: row.name,
    scope: { ...(row.scope_collection ? { collection: row.scope_collection } : {}), ...(row.scope_taxonomy ? { taxonomy: row.scope_taxonomy } : {}) },
    isDefault: !!row.is_default,
    guidance: row.guidance,
    sources: await sourcesForProfile(row.id),
    status: row.status,
    revision: row.revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listConfigurationProfiles(connectionId: string, kind: ConfigurationProfileKind, includeArchived = false): Promise<ConfigurationProfile[]> {
  const rows = await db().prepare(`SELECT * FROM configuration_profiles WHERE connection_id=? AND kind=? ${includeArchived ? "" : "AND status='active'"} ORDER BY is_default DESC, name COLLATE NOCASE`).all(connectionId, kind) as ProfileRow[];
  return Promise.all(rows.map(profileFromRow));
}

async function assertDocumentsBelongToConnection(connectionId: string, sources: ConfigurationSource[]) {
  for (const source of sources) {
    if (source.type !== "document") continue;
    const found = await db().prepare("SELECT 1 FROM configuration_documents WHERE id=? AND connection_id=?").get(source.documentId, connectionId);
    if (!found) throw new Error("Configuration document was not found for this customer.");
  }
}

async function insertSources(profileId: string, sources: ConfigurationSource[], timestamp: string) {
  for (const [position, source] of sources.entries()) {
    await db().prepare("INSERT INTO configuration_profile_sources(id,profile_id,source_type,text_content,document_id,solution_id,position,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(randomUUID(), profileId, source.type, source.type === "text" ? source.text : null, source.type === "document" ? source.documentId : null, source.type === "solution" ? source.solutionId : null, position, timestamp);
  }
}

function profileCandidate(id: string, connectionId: string, draft: ConfigurationProfileDraft, status: ConfigurationProfileStatus = "active"): ConfigurationProfile {
  const timestamp = now();
  return { ...draft, id, connectionId, status, revision: 1, createdAt: timestamp, updatedAt: timestamp };
}

async function assertNoScopeConflict(connectionId: string, candidate: ConfigurationProfile) {
  const profiles = await listConfigurationProfiles(connectionId, candidate.kind, true);
  const conflicts = findScopeConflicts(profiles, candidate);
  if (conflicts.length) throw new ConfigurationScopeConflictError(conflicts.map((profile) => profile.name));
}

export async function createConfigurationProfile(args: { connectionId: string; createdBy: string; draft: unknown }): Promise<ConfigurationProfile> {
  const draft = configurationProfileDraftSchema.parse(args.draft);
  const id = randomUUID();
  const candidate = profileCandidate(id, args.connectionId, draft);
  await assertDocumentsBelongToConnection(args.connectionId, draft.sources);
  await assertNoScopeConflict(args.connectionId, candidate);
  const timestamp = now();
  await db().transaction(async () => {
    await db().prepare("INSERT INTO configuration_profiles(id,connection_id,kind,name,scope_collection,scope_taxonomy,is_default,status,guidance,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, args.connectionId, draft.kind, draft.name, draft.scope.collection ?? null, draft.scope.taxonomy ?? null, draft.isDefault ? 1 : 0, "active", draft.guidance, 1, args.createdBy, timestamp, timestamp);
    await insertSources(id, draft.sources, timestamp);
  })();
  return { ...candidate, createdAt: timestamp, updatedAt: timestamp };
}

export async function updateConfigurationProfile(args: { id: string; connectionId: string; draft: unknown }): Promise<ConfigurationProfile> {
  const draft = configurationProfileDraftSchema.parse(args.draft);
  const current = (await db().prepare("SELECT * FROM configuration_profiles WHERE id=? AND connection_id=?").get(args.id, args.connectionId)) as ProfileRow | undefined;
  if (!current) throw new Error("Configuration profile was not found for this customer.");
  if (current.kind !== draft.kind) throw new Error("A configuration profile cannot change its kind.");
  const candidate = { ...profileCandidate(args.id, args.connectionId, draft, current.status), revision: current.revision + 1, createdAt: current.created_at, updatedAt: now() };
  await assertDocumentsBelongToConnection(args.connectionId, draft.sources);
  await assertNoScopeConflict(args.connectionId, candidate);
  const timestamp = candidate.updatedAt;
  await db().transaction(async () => {
    await db().prepare("UPDATE configuration_profiles SET name=?,scope_collection=?,scope_taxonomy=?,is_default=?,guidance=?,revision=?,updated_at=? WHERE id=? AND connection_id=?")
      .run(draft.name, draft.scope.collection ?? null, draft.scope.taxonomy ?? null, draft.isDefault ? 1 : 0, draft.guidance, candidate.revision, timestamp, args.id, args.connectionId);
    await db().prepare("DELETE FROM configuration_profile_sources WHERE profile_id=?").run(args.id);
    await insertSources(args.id, draft.sources, timestamp);
  })();
  return candidate;
}

export async function archiveConfigurationProfile(id: string, connectionId: string): Promise<void> {
  const result = await db().prepare("UPDATE configuration_profiles SET status='archived',updated_at=? WHERE id=? AND connection_id=? AND status='active'").run(now(), id, connectionId);
  if (!result.changes) throw new Error("Active configuration profile was not found for this customer.");
}
