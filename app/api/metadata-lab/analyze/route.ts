import { requireActor, apiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { z } from "zod";
import { analyzeMetadata } from "@/lib/metadata/engine";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request);
    const { solutionId } = await readJson(request, z.object({ solutionId: z.string().regex(/^[\w-]{1,100}$/) }));
    const encoder = new TextEncoder();
    const abort = new AbortController();
    let connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (event: unknown) => { if (connected) { try { controller.enqueue(encoder.encode(JSON.stringify(event) + "\n")); } catch { connected = false; abort.abort(); } } };
        try {
          const report = await analyzeMetadata(solutionId, { impUser: actor }, message => send({ type: "progress", message }), abort.signal);
          send({ type: "result", report });
        } catch (error) { send({ type: "error", message: error instanceof Error ? error.message : "Analysis failed" }); }
        finally { if (connected) controller.close(); }
      },
      cancel() { connected = false; abort.abort(); },
    });
    return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
