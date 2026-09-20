import { z } from "zod";
import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { resolveConnection } from "@/lib/ra/connections";
import { ra, withRaConnection } from "@/lib/ra/client";
import { addContextItem, getThread, listContextItems } from "@/lib/agent/store";

export const dynamic = "force-dynamic";
const inputSchema = z.object({ solutionId: z.string().regex(/^\d{15}$/), role: z.enum(["reference", "target", "standard"]).default("reference") });

export async function GET(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const owner = await requireActor(request); const { threadId } = await context.params;
    return Response.json({ contextItems: await listContextItems(owner, threadId) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ threadId: string }> }) {
  try {
    const owner = await requireActor(request); const { threadId } = await context.params;
    const thread = await getThread(owner, threadId); const input = await readJson(request, inputSchema);
    const connection = await resolveConnection(owner, thread.connectionId);
    const solution = await withRaConnection(owner, connection, () => ra.getSolution(input.solutionId));
    const item = await addContextItem(owner, threadId, {
      solutionId: solution.id, title: solution.title, role: input.role,
      snapshot: { id: solution.id, title: solution.title, status: solution.status, summary: solution.summary, templateName: solution.templateName, language: solution.language, collections: solution.collections, taxonomy: solution.taxonomy, fields: solution.fields ?? [] },
    });
    return Response.json({ item }, { status: 201 });
  } catch (error) { return apiError(error); }
}
