import { resolveGroundContext } from "@/lib/ground-context/server";
import { assertImageOwnership } from "@/lib/ingest/image-store";
import { assertAgentFileOwnership } from "@/lib/agent/file-store";
import { saveExecutedFlow } from "@/lib/flow/executions";
import { runPipeline } from "@/lib/pipeline/run";
import { completeRun, createRun, failRun } from "@/lib/db/runs";
import { mapRunToView } from "@/lib/ks/model";
import { requireActor, apiError } from "@/lib/api/auth";
import { readJson, runSchema } from "@/lib/api/validation";
import { withAiAudit } from "@/lib/llm/audit";
import { withRaConnection } from "@/lib/ra/client";
import { resolveConnection } from "@/lib/ra/connections";
import { getSolutionReviewHandoff } from "@/lib/ks/solution-reviews";
import { randomUUID } from "node:crypto";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const input = await readJson(request, runSchema);
    const handoff = input.reviewHandoffId ? await getSolutionReviewHandoff(author, input.reviewHandoffId) : undefined;
    if (handoff?.stale) throw new Error("This solution changed after the review. Refresh the review before analysis.");
    const authorizedInput = handoff ? { ...input, connectionId: handoff.connectionId, sourceSolutionIds: [handoff.solutionId], reviewObjectives: handoff.reviewObjectives } : input;
    await assertImageOwnership(authorizedInput, author);
    await assertAgentFileOwnership((authorizedInput.attachments ?? []).flatMap(attachment => attachment.fileId ? [attachment.fileId] : []), author);
    // The browser may identify an uploaded file, but only the server binds it to its owner.
    const safeInput = { ...authorizedInput, attachments: authorizedInput.attachments?.map(attachment => attachment.fileId ? { ...attachment, fileOwner: author } : attachment) };
    const connection = await resolveConnection(author, safeInput.connectionId);
    const runId = `run-${randomUUID()}`;
    const groundContext = await withRaConnection(author, connection, () => resolveGroundContext(safeInput.groundContext, safeInput.sourceSolutionIds, author));
    (await createRun({ id: runId, author, connectionId: connection.id, groundContext, path: safeInput.path ?? null, inputText: safeInput.text, sourceIds: safeInput.sourceSolutionIds ?? [], operations: safeInput.operations, attachments: safeInput.attachments, content: safeInput.content }));
    const encoder = new TextEncoder();
    let connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => { if (connected) { try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch { connected = false; } } };
        send({ type: "runId", runId });
        try {
          const result = await withRaConnection(author, connection, () => withAiAudit(runId, "analysis", () => runPipeline(safeInput, (e) => send({ type: "progress", ...e }), groundContext)));
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
