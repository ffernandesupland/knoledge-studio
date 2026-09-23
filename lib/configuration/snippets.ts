import sanitizeHtml from "sanitize-html";
import { randomUUID } from "node:crypto";
import { db } from "../db";
import { snippetDraftSchema, type Snippet, type SnippetDraft } from "./types";

const snippetHtmlOptions: sanitizeHtml.IOptions = {
  allowedTags: ["div", "section", "aside", "p", "br", "span", "strong", "em", "b", "i", "u", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "code", "pre", "hr", "table", "thead", "tbody", "tr", "th", "td", "a", "details", "summary"],
  allowedAttributes: { "*": ["class", "id", "role", "aria-label", "aria-describedby"], a: ["href", "title", "target", "rel"] },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesAppliedToAttributes: ["href"],
  disallowedTagsMode: "discard",
};

export function sanitizeSnippetHtml(value: string): string {
  const html = sanitizeHtml(value, snippetHtmlOptions).trim();
  if (!html.replace(/<[^>]+>/g, "").replace(/&nbsp;|&#160;/g, " ").trim()) throw new Error("Snippet HTML must contain readable content after sanitization.");
  return html;
}

type Row = { id: string; connection_id: string; name: string; purpose: string; html: string; active: number; scope_collection: string | null; scope_taxonomy: string | null; revision: number; created_at: string; updated_at: string };
function fromRow(row: Row): Snippet {
  return { id: row.id, connectionId: row.connection_id, name: row.name, purpose: row.purpose, html: row.html, active: !!row.active, scope: { ...(row.scope_collection ? { collection: row.scope_collection } : {}), ...(row.scope_taxonomy ? { taxonomy: row.scope_taxonomy } : {}) }, revision: row.revision, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function listSnippets(connectionId: string, includeInactive = false): Promise<Snippet[]> {
  const rows = await db().prepare(`SELECT * FROM configuration_snippets WHERE connection_id=? ${includeInactive ? "" : "AND active=1"} ORDER BY name COLLATE NOCASE`).all(connectionId) as Row[];
  return rows.map(fromRow);
}

function preparedDraft(raw: unknown): SnippetDraft {
  const draft = snippetDraftSchema.parse(raw);
  return { ...draft, html: sanitizeSnippetHtml(draft.html) };
}

export async function createSnippet(args: { connectionId: string; createdBy: string; draft: unknown }): Promise<Snippet> {
  const draft = preparedDraft(args.draft);
  const id = randomUUID(), timestamp = new Date().toISOString();
  await db().prepare("INSERT INTO configuration_snippets(id,connection_id,name,purpose,html,active,scope_collection,scope_taxonomy,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, args.connectionId, draft.name, draft.purpose, draft.html, draft.active ? 1 : 0, draft.scope.collection ?? null, draft.scope.taxonomy ?? null, 1, args.createdBy, timestamp, timestamp);
  return { id, connectionId: args.connectionId, ...draft, revision: 1, createdAt: timestamp, updatedAt: timestamp };
}

export async function updateSnippet(args: { id: string; connectionId: string; draft: unknown }): Promise<Snippet> {
  const draft = preparedDraft(args.draft);
  const current = await db().prepare("SELECT * FROM configuration_snippets WHERE id=? AND connection_id=?").get(args.id, args.connectionId) as Row | undefined;
  if (!current) throw new Error("Snippet was not found for this customer.");
  const revision = current.revision + 1, timestamp = new Date().toISOString();
  await db().prepare("UPDATE configuration_snippets SET name=?,purpose=?,html=?,active=?,scope_collection=?,scope_taxonomy=?,revision=?,updated_at=? WHERE id=? AND connection_id=?")
    .run(draft.name, draft.purpose, draft.html, draft.active ? 1 : 0, draft.scope.collection ?? null, draft.scope.taxonomy ?? null, revision, timestamp, args.id, args.connectionId);
  return { id: args.id, connectionId: args.connectionId, ...draft, revision, createdAt: current.created_at, updatedAt: timestamp };
}

export async function archiveSnippet(id: string, connectionId: string): Promise<void> {
  const result = await db().prepare("UPDATE configuration_snippets SET active=0,updated_at=? WHERE id=? AND connection_id=? AND active=1").run(new Date().toISOString(), id, connectionId);
  if (!result.changes) throw new Error("Active snippet was not found for this customer.");
}
