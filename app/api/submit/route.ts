import { saveExecutedFlow } from "@/lib/flow/executions";
import { z } from "zod";
import { executeWritePlan, type ExecuteArgs } from "@/lib/pipeline/execute";
import { buildWritePlan } from "@/lib/pipeline/submit";
import { getRun, markPartial, markSubmitted, saveSnapshot } from "@/lib/db/runs";
import { requireActor, apiError } from "@/lib/api/auth";
import { readJson, canonicalSnapshot, assertOwner, reviewSchema } from "@/lib/api/validation";
import { freezeExecution, loadExecution, withRunLock } from "@/lib/pipeline/state";
import { withAiAudit } from "@/lib/llm/audit";
import { ra, withRaActor } from "@/lib/ra/client";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const schema = z.object({ runId: z.string().max(100), snapshot: z.unknown(), reviews: reviewSchema.optional(), dryRun: z.boolean().optional() });
export async function POST(request: Request) {
  try {
    const user = await requireActor(request);
    const body = await readJson(request, schema);
    const run = getRun(body.runId);
    assertOwner(run, user);
    const snapshot = canonicalSnapshot(run, body.snapshot);
    const plan = buildWritePlan({ runId: run.id, candidates: snapshot.candidates, groups: snapshot.groups, selected: new Set(snapshot.selectedKeys), resolutions: snapshot.resolutions });
    if (!plan.length) throw new Error("Select at least one article to submit");
    if (body.dryRun) return Response.json({ plan });
    const collections = await ra.getCollections({ impUser: user });
    const collection = collections.find((c) => c.code === snapshot.collection || c.displayName === snapshot.collection)?.code;
    if (!collection || !snapshot.language) throw new Error("Choose a valid collection and language");
    const encoder = new TextEncoder();
    let connected = true;
    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj: unknown) => { if (connected) { try { controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n")); } catch { connected = false; } } };
        try {
          await withRunLock(run.id, async () => {
            if (!loadExecution(run.id)) saveSnapshot(run.id, snapshot);
            const args = freezeExecution<ExecuteArgs>(run.id, { runId: run.id, user, plan, collection, language: snapshot.language, restructureEnabled: snapshot.operations.some((o) => o.name === "Restructure content" && o.on), standardsRules: snapshot.operations.some((o) => o.name === "Apply content standards" && o.on) ? snapshot.standardsRules : [] });
            markPartial(run.id);
            send({ type: "plan", plan: args.plan });
            const results = await withRaActor(user, () => withAiAudit(run.id, "submission", () => executeWritePlan({ ...args, reviews: body.reviews }, (p) => send({ type: "progress", ...p }))));
            if (results.every((r) => r.outcome === "ok")) markSubmitted(run.id);
            else markPartial(run.id);
            saveExecutedFlow(run.id);
            send({ type: "result", results, costUsd: getRun(run.id)?.costUsd });
          });
        } catch (err) { send({ type: "error", message: (err as Error).message }); }
        finally { if (connected) controller.close(); }
      }, cancel() { connected = false; },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) { return apiError(err); }
}
