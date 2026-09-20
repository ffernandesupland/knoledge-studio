import { apiError, requireActor } from "@/lib/api/auth";
import { getThread, listContextItems, listMessages } from "@/lib/agent/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const owner = await requireActor(request);
    const { threadId } = await context.params;
    const thread = await getThread(owner, threadId);
    const [messages, contextItems] = await Promise.all([listMessages(owner, threadId), listContextItems(owner, threadId)]);
    return Response.json({ thread, messages, contextItems }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
