import { z } from "zod";
import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { readJson, runSchema } from "@/lib/api/validation";
import { enabled, enqueue, getJob, latestJob, workerOnline } from "@/lib/autonomous/store";
import { getRun } from "@/lib/db/runs";
import { executionResults, loadExecution } from "@/lib/pipeline/state";
import type { ExecuteArgs } from "@/lib/pipeline/execute";
import { buildSubmissionGraph } from "@/lib/ks/submission-graph";

export const dynamic = "force-dynamic";
// These endpoints only enqueue/read durable state. The Node worker owns execution.
const schema = z.object({ requestId: z.string().uuid(), autonomous: z.literal(true), input: runSchema.and(z.object({ standardsRules: z.array(z.string().min(1).max(500)).max(20) })) });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    if (!enabled()) throw new ApiError("Autonomous mode is not enabled on this server", 503);
    const body = await readJson(request, schema);
    if (!body.input.text.trim() && !body.input.attachments?.some(a => a.text.trim()) && !body.input.sourceSolutionIds?.length) throw new ApiError("Add supported source content before starting an autonomous run");
    const id = `auto-${body.requestId}`;
    // Idempotent retries remain available even if the worker has since disconnected.
    if (!await getJob(id) && !await workerOnline()) throw new ApiError("The autonomous worker is offline. Start the Node worker or use the guided flow.", 503);
    const job = await enqueue(id, author, body.input);
    return json({ runId: job.runId, status: job.status }, 202);
  } catch (e) { return apiError(e); }
}
export async function GET(request: Request) {
  try {
    const author = await requireActor(request);
    const id = new URL(request.url).searchParams.get("runId");
    if (!id) {
      const latest = await latestJob(author);
      return json({ enabled: enabled(), workerOnline: await workerOnline(), latest: latest ? { runId: latest.runId, status: latest.status } : undefined });
    }
    const job = await getJob(id);
    if (!job || job.author !== author) throw new ApiError("Run not found", 404);
    const run = await getRun(id);
    const execution = await loadExecution<ExecuteArgs>(id);
    const results = await executionResults(id);
    return json({ runId: id, status: job.status, stage: job.stage, updatedAt: job.updatedAt, error: job.error, authorization: job.authorization, workerOnline: await workerOnline(), costUsd: run?.costUsd ?? 0,
      graph: execution ? buildSubmissionGraph(execution.plan, run?.snapshot?.candidates ?? run?.candidates, results, { ...execution, groups: run?.snapshot?.groups ?? run?.groups }) : undefined });
  } catch (e) { return apiError(e); }
}
