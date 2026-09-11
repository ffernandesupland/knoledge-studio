import { z } from "zod";
import { requireActor, apiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { resumePlanning } from "@/lib/autonomous/recovery";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const { runId } = await readJson(request, z.object({ runId: z.string().min(1).max(100) }));
    await resumePlanning(runId, author);
    return Response.json({ runId, status: "queued" }, { headers: { "cache-control": "no-store" } });
  } catch (e) { return apiError(e); }
}
