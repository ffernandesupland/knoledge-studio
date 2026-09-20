import { z } from "zod";
import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { resolveConnection } from "@/lib/ra/connections";
import { createThread, listThreads } from "@/lib/agent/store";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try { return Response.json({ threads: await listThreads(await requireActor(request)) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const owner = await requireActor(request);
    const input = await readJson(request, z.object({ connectionId: z.string().max(100).optional(), title: z.string().trim().min(1).max(160).optional() }));
    const connection = await resolveConnection(owner, input.connectionId);
    const thread = await createThread(owner, connection.id, input.title ?? "New AI workspace");
    return Response.json({ thread }, { status: 201 });
  } catch (error) { return apiError(error); }
}
