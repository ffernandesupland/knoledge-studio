import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { getRun } from "@/lib/db/runs";
import { pastExecutions, readExecutedFlow, saveExecutedFlow } from "@/lib/flow/executions";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const author = await requireActor(request);
    const query = new URL(request.url).searchParams;
    const runId = query.get("runId");
    if (runId) {
      const run = (await getRun(runId));
      if (!run || run.author !== author) throw new ApiError("Run not found", 404);
      const saved = (await readExecutedFlow(runId));
      // Active/partial decisions can still change. Completed executions retain their saved tree.
      const flow = saved && (saved.mode !== "autonomous" || saved.outcome) && ["submitted", "discarded", "error"].includes(run.status) && saved.status === run.status ? saved : (await saveExecutedFlow(runId));
      return Response.json(flow, { headers: { "cache-control": "no-store" } });
    }
    const offset = Number(query.get("offset") ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) return Response.json({ error: "Invalid history offset" }, { status: 400 });
    return Response.json((await pastExecutions(author, offset)), { headers: { "cache-control": "no-store" } });
  } catch (e) { return apiError(e); }
}
