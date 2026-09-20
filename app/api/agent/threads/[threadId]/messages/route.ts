import { z } from "zod";
import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { resolveConnection } from "@/lib/ra/connections";
import { runAgentTurn } from "@/lib/agent/orchestrator";
import { addEvent, addMessage, getThread, listContextItems, listMessages, renameThread } from "@/lib/agent/store";
import { getImage } from "@/lib/ingest/image-store";
import { getAgentFile } from "@/lib/agent/file-store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const attachmentSchema = z.object({ label: z.string().trim().min(1).max(500), text: z.string().max(500_000), kind: z.enum(["pdf", "docx", "text", "image"]), imageId: z.string().uuid().optional(), fileId: z.string().uuid().optional(), meta: z.string().max(500).default("") })
  .superRefine((value, context) => { if (value.kind === "image" && !value.imageId) context.addIssue({ code: "custom", message: "Image attachment is missing its image ID" }); });
const inputSchema = z.object({ content: z.string().trim().max(12_000), attachments: z.array(attachmentSchema).max(4).default([]) })
  .refine((value) => value.content.length > 0 || value.attachments.length > 0, "Write a message or attach a file")
  .refine((value) => value.attachments.reduce((total, attachment) => total + attachment.text.length, 0) <= 500_000, "Use smaller attachments (500,000 extracted characters maximum)");

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const owner = await requireActor(request); const { threadId } = await context.params;
    const input = await readJson(request, inputSchema); const thread = await getThread(owner, threadId);
    for (const attachment of input.attachments) if (attachment.imageId) await getImage(attachment.imageId, owner);
    for (const attachment of input.attachments) if (attachment.fileId) await getAgentFile(attachment.fileId, owner);
    const userMessage = await addMessage(threadId, "user", input.content, input.attachments);
    if (thread.title === "New AI workspace") await renameThread(owner, threadId, input.content.slice(0, 80));
    const [connection, contextItems, history] = await Promise.all([resolveConnection(owner, thread.connectionId), listContextItems(owner, threadId), listMessages(owner, threadId)]);
    const result = await runAgentTurn({ actor: owner, connection, intent: input.content, context: contextItems, history });
    const assistantMessage = await addMessage(threadId, "assistant", result.content);
    await addEvent(threadId, "agent_turn", { tools: result.usedTools, messageId: assistantMessage.id });
    return Response.json({ userMessage, assistantMessage, usedTools: result.usedTools });
  } catch (error) { return apiError(error); }
}
