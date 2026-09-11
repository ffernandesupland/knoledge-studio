import { z } from "zod";
import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { claim, getJob, heartbeat, release } from "@/lib/autonomous/store";
import { processJob } from "@/lib/autonomous/runner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
/** One saved step per request. No detached work, external worker or scheduler. */
export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const { runId } = await readJson(request, z.object({ runId: z.string().min(1).max(100) }));
    const job = await getJob(runId);
    if (!job || job.author !== author) throw new ApiError("Run not found", 404);
    const claimed = await claim(runId);
    const encoder = new TextEncoder();
    let connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (data: unknown) => { if (connected) { try { controller.enqueue(encoder.encode(JSON.stringify(data) + "\n")); } catch { connected = false; } } };
        const timer = claimed ? setInterval(() => {
          void heartbeat(runId, claimed.token).catch(() => {});
          send({ type: "progress", message: "Processing the current step" });
        }, 15_000) : undefined;
        try {
          if (claimed) {
            send({ type: "progress", message: "Continuing the saved run" });
            await processJob(claimed.job, claimed.token, true);
          }
          send({ type: "result", status: (await getJob(runId))?.status, busy: !claimed && ["queued", "running"].includes(job.status) });
        } catch (e) { send({ type: "error", message: e instanceof Error ? e.message : "Could not continue this step" }); }
        finally {
          clearInterval(timer);
          try { if (claimed) await release(runId, claimed.token); }
          finally { if (connected) controller.close(); }
        }
      }, cancel() { connected = false; },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) { return apiError(e); }
}
