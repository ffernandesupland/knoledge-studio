import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { events, eventDetail, getJob } from "@/lib/autonomous/store";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const author = await requireActor(request);
    const query = new URL(request.url).searchParams;
    const runId = query.get("runId") ?? "";
    const job = await getJob(runId);
    if (!job || job.author !== author) throw new ApiError("Run not found", 404);
    const id = query.get("eventId"), after = Number(query.get("after") ?? 0);
    if (!Number.isSafeInteger(after) || after < 0 || (id && (!Number.isSafeInteger(Number(id)) || Number(id) < 1))) throw new ApiError("Invalid event cursor");
    if (id) {
      const detail = await eventDetail(runId, Number(id));
      if (!detail) throw new ApiError("Event not found", 404);
      return Response.json(detail, { headers: { "cache-control": "no-store" } });
    }
    // Keep long prompts out of polling responses; fetch their full payload on demand.
    const page = await events(runId, after, 101, false);
    return Response.json({ events: page.slice(0, 100), hasMore: page.length > 100 }, { headers: { "cache-control": "no-store" } });
  } catch (e) { return apiError(e); }
}
