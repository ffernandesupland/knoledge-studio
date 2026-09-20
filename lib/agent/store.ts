import { randomUUID } from "node:crypto";
import { ApiError } from "../api/auth";
import { db } from "../db";
import { renderAssistantMarkdown, userFacingAssistantContent } from "./markdown";
import type { AgentAttachment, AgentContextItem, AgentContextRole, AgentMessage, AgentMessageRole, AgentThread, SolutionSnapshot } from "./types";

type ThreadRow = { id: string; owner: string; title: string; connection_id: string; created_at: string; updated_at: string };
type MessageRow = { id: string; thread_id: string; role: AgentMessageRole; content: string; created_at: string };
type AttachmentRow = { id: string; message_id: string; label: string; text: string; kind: AgentAttachment["kind"]; image_id: string | null; file_id: string | null; meta: string };
type ContextRow = { id: string; thread_id: string; solution_id: string; title: string; role: AgentContextRole; snapshot: string; created_at: string };

const toThread = (row: ThreadRow): AgentThread => ({ id: row.id, owner: row.owner, title: row.title, connectionId: row.connection_id, createdAt: row.created_at, updatedAt: row.updated_at });
const toAttachment = (row: AttachmentRow): AgentAttachment => ({ id: row.id, label: row.label, text: row.text, kind: row.kind, imageId: row.image_id ?? undefined, fileId: row.file_id ?? undefined, meta: row.meta });
const toContext = (row: ContextRow): AgentContextItem => ({ id: row.id, threadId: row.thread_id, solutionId: row.solution_id, title: row.title, role: row.role, snapshot: JSON.parse(row.snapshot) as SolutionSnapshot, createdAt: row.created_at });

export async function createThread(owner: string, connectionId: string, title = "New AI workspace") {
  const id = randomUUID();
  const now = new Date().toISOString();
  await db().prepare("INSERT INTO agent_threads(id,owner,title,connection_id,created_at,updated_at) VALUES(?,?,?,?,?,?)").run(id, owner, title, connectionId, now, now);
  return { id, owner, title, connectionId, createdAt: now, updatedAt: now } satisfies AgentThread;
}

export async function listThreads(owner: string) {
  const rows = await db().prepare("SELECT * FROM agent_threads WHERE owner=? ORDER BY updated_at DESC LIMIT 50").all(owner) as ThreadRow[];
  return rows.map(toThread);
}

export async function getThread(owner: string, id: string) {
  const row = await db().prepare("SELECT * FROM agent_threads WHERE id=? AND owner=?").get(id, owner) as ThreadRow | undefined;
  if (!row) throw new ApiError("AI workspace not found", 404);
  return toThread(row);
}

export async function renameThread(owner: string, id: string, title: string) {
  await getThread(owner, id);
  const now = new Date().toISOString();
  await db().prepare("UPDATE agent_threads SET title=?,updated_at=? WHERE id=? AND owner=?").run(title, now, id, owner);
}

export async function addMessage(threadId: string, role: AgentMessageRole, content: string, attachments: Omit<AgentAttachment, "id">[] = []) {
  const id = randomUUID();
  const now = new Date().toISOString();
  const userFacingContent = role === "assistant" ? userFacingAssistantContent(content) : content;
  const savedAttachments = attachments.map((attachment) => ({ ...attachment, id: randomUUID() }));
  await db().transaction(async () => {
    await db().prepare("INSERT INTO agent_messages(id,thread_id,role,content,created_at) VALUES(?,?,?,?,?)").run(id, threadId, role, userFacingContent, now);
    for (const attachment of savedAttachments) {
      await db().prepare("INSERT INTO agent_message_attachments(id,message_id,label,text,kind,image_id,meta) VALUES(?,?,?,?,?,?,?)")
        .run(attachment.id, id, attachment.label, attachment.text, attachment.kind, attachment.imageId ?? null, attachment.meta);
      if (attachment.fileId) await db().prepare("INSERT INTO agent_attachment_files(attachment_id,uploaded_file_id) VALUES(?,?)").run(attachment.id, attachment.fileId);
    }
    await db().prepare("UPDATE agent_threads SET updated_at=? WHERE id=?").run(now, threadId);
  })();
  return { id, threadId, role, content: userFacingContent, html: role === "assistant" ? renderAssistantMarkdown(userFacingContent) : undefined, attachments: savedAttachments, createdAt: now } satisfies AgentMessage;
}

export async function listMessages(owner: string, threadId: string) {
  await getThread(owner, threadId);
  const rows = await db().prepare("SELECT * FROM agent_messages WHERE thread_id=? ORDER BY created_at ASC LIMIT 100").all(threadId) as MessageRow[];
  const attachments = await db().prepare("SELECT a.*, f.uploaded_file_id AS file_id FROM agent_message_attachments a LEFT JOIN agent_attachment_files f ON f.attachment_id=a.id WHERE a.message_id IN (SELECT id FROM agent_messages WHERE thread_id=?) ORDER BY a.rowid ASC").all(threadId) as AttachmentRow[];
  const byMessage = new Map<string, AgentAttachment[]>();
  for (const attachment of attachments) byMessage.set(attachment.message_id, [...(byMessage.get(attachment.message_id) ?? []), toAttachment(attachment)]);
  return rows.map((row) => {
    const content = row.role === "assistant" ? userFacingAssistantContent(row.content) : row.content;
    return { id: row.id, threadId: row.thread_id, role: row.role, content, html: row.role === "assistant" ? renderAssistantMarkdown(content) : undefined, attachments: byMessage.get(row.id) ?? [], createdAt: row.created_at };
  });
}

export async function addContextItem(owner: string, threadId: string, item: Omit<AgentContextItem, "id" | "threadId" | "createdAt">) {
  await getThread(owner, threadId);
  const id = randomUUID();
  const now = new Date().toISOString();
  await db().prepare("INSERT INTO agent_context_items(id,thread_id,solution_id,title,role,snapshot,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(thread_id,solution_id) DO UPDATE SET title=excluded.title,role=excluded.role,snapshot=excluded.snapshot,created_at=excluded.created_at")
    .run(id, threadId, item.solutionId, item.title, item.role, JSON.stringify(item.snapshot), now);
  const row = await db().prepare("SELECT * FROM agent_context_items WHERE thread_id=? AND solution_id=?").get(threadId, item.solutionId) as ContextRow;
  return toContext(row);
}

export async function listContextItems(owner: string, threadId: string) {
  await getThread(owner, threadId);
  const rows = await db().prepare("SELECT * FROM agent_context_items WHERE thread_id=? ORDER BY created_at ASC").all(threadId) as ContextRow[];
  return rows.map(toContext);
}

export async function addEvent(threadId: string, kind: string, detail: unknown) {
  await db().prepare("INSERT INTO agent_events(id,thread_id,kind,detail,created_at) VALUES(?,?,?,?,?)").run(randomUUID(), threadId, kind, JSON.stringify(detail), new Date().toISOString());
}
