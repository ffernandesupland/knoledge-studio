import { resolveGroundContext } from "@/lib/ground-context/server";
import { assertImageOwnership } from "@/lib/ingest/image-store";
import { saveExecutedFlow } from "@/lib/flow/executions";
import { runPipeline } from "@/lib/pipeline/run";
import { completeRun, createRun, failRun } from "@/lib/db/runs";
import { mapRunToView } from "@/lib/ks/model";
import { requireActor, apiError } from "@/lib/api/auth";
import { readJson, runSchema } from "@/lib/api/validation";
import { withAiAudit } from "@/lib/llm/audit";
import { withRaConnection } from "@/lib/ra/client";
import { resolveConnection } from "@/lib/ra/connections";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const input = await readJson(request, runSchema);
    await assertImageOwnership(input, author);
    const connection = await resolveConnection(author, input.connectionId);
    const runId = `run-${randomUUID()}`;
    const groundContext = await withRaConnection(author, connection, () => resolveGroundContext(input.groundContext, input.sourceSolutionIds, author));
    (await createRun({ id: runId, author, connectionId: connection.id, groundContext, path: input.path ?? null, inputText: input.text, sourceIds: input.sourceSolutionIds ?? [], operations: input.operations, attachments: input.attachments, content: input.content }));
    const encoder = new TextEncoder();
    let connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => { if (connected) { try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch { connected = false; } } };
        send({ type: "runId", runId });
        try {
          const result = await withRaConnection(author, connection, () => withAiAudit(runId, "analysis", () => runPipeline(input, (e) => send({ type: "progress", ...e }), groundContext)));
          (await completeRun(runId, mapRunToView(result)));
          (await saveExecutedFlow(runId));
          send({ type: "result", runId, ...result });
        } catch (err) {
          const message = (err as Error).message;
          (await failRun(runId, message));
          (await saveExecutedFlow(runId));
          send({ type: "error", message });
        } finally { if (connected) controller.close(); }
      },
      cancel() { connected = false; },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  } catch (e) { return apiError(e); }
}
