import { assertGuided } from "@/lib/autonomous/store";
import { saveExecutedFlow } from "@/lib/flow/executions";
import { z } from "zod";
import { assertPreparedPlan, executeWritePlan, type ExecuteArgs } from "@/lib/pipeline/execute";
import { buildWritePlan } from "@/lib/pipeline/submit";
import { getRun, markPartial, markSubmitted, saveSnapshot } from "@/lib/db/runs";
import { requireActor, apiError } from "@/lib/api/auth";
import { readJson, canonicalSnapshot, assertOwner, reviewSchema } from "@/lib/api/validation";
import { freezePreparedPlan, savePreparationPlan, loadExecution, withRunLock } from "@/lib/pipeline/state";
import { withAiAudit } from "@/lib/llm/audit";
import { ra, withRaActor } from "@/lib/ra/client";

import { submissionIdentity } from "@/lib/ks/submission-plan";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const schema = z.object({ runId: z.string().max(100), snapshot: z.unknown(), reviews: reviewSchema.optional(), dryRun: z.boolean().optional(), action: z.enum(["prepare", "submit"]).default("submit"), approvals: z.record(z.string(), z.string().uuid()).optional() });
export async function POST(request: Request) {
  try {
    const user = await requireActor(request);
    const body = await readJson(request, schema);
    const run = (await getRun(body.runId));
    assertOwner(run, user);
    await assertGuided(run.id);
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
            const stored = await loadExecution<ExecuteArgs>(run.id);
            const reviewIdentity = submissionIdentity(plan, snapshot);
            const proposed: ExecuteArgs = { runId: run.id, user, plan, collection, language: snapshot.language, stage: "preparation", reviewIdentity, restructureEnabled: snapshot.operations.some((o) => o.name === "Restructure content" && o.on), standardsRules: snapshot.operations.some((o) => o.name === "Apply content standards" && o.on) ? snapshot.standardsRules : [] };
            let args: ExecuteArgs;
            if (body.action === "prepare") {
              args = await savePreparationPlan(run.id, proposed);
              if (!stored || stored.stage === "preparation") await saveSnapshot(run.id, snapshot);
            } else {
              if (!stored) throw new Error("Prepare and review the drafts before submitting.");
              if (stored.reviewIdentity && stored.reviewIdentity !== reviewIdentity) throw new Error("The plan changed. Prepare and review the updated drafts before submitting.");
              await assertPreparedPlan({ ...stored, approvals: body.approvals, reviews: body.reviews });
              args = await freezePreparedPlan(run.id, stored);
              await markPartial(run.id);
            }
            send({ type: "plan", plan: args.plan, reviewIdentity: args.reviewIdentity, stage: args.stage });
            const results = await withRaActor(user, () => withAiAudit(run.id, body.action === "prepare" ? "preparation" : "submission", () => executeWritePlan({ ...args, prepareOnly: body.action === "prepare", requirePrepared: body.action === "submit", approvals: body.approvals, reviews: body.reviews }, (p) => send({ type: "progress", ...p }))));
            if (body.action === "submit") {
              if (results.every((r) => r.outcome === "ok")) await markSubmitted(run.id);
              else await markPartial(run.id);
            }
            (await saveExecutedFlow(run.id));
            send({ type: "result", results, stage: args.stage, reviewIdentity: args.reviewIdentity, costUsd: (await getRun(run.id))?.costUsd });
          });
        } catch (err) { send({ type: "error", message: (err as Error).message }); }
        finally { if (connected) controller.close(); }
      }, cancel() { connected = false; },
    });
    return new Response(stream, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
  } catch (err) { return apiError(err); }
}
