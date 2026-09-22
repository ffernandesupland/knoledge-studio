import { resolveGroundContext } from "@/lib/ground-context/server";
import { assertImageOwnership } from "@/lib/ingest/image-store";
import { assertAgentFileOwnership } from "@/lib/agent/file-store";
import { z } from "zod";
import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { readJson, runSchema } from "@/lib/api/validation";
import { enqueue, getJob, latestJob } from "@/lib/autonomous/store";
import { getRun } from "@/lib/db/runs";
import { executionResults, loadExecution } from "@/lib/pipeline/state";
import type { ExecuteArgs } from "@/lib/pipeline/execute";
import { buildSubmissionGraph } from "@/lib/ks/submission-graph";
import { autonomousOutcome } from "@/lib/autonomous/outcome";
import { resolveConnection } from "@/lib/ra/connections";
import { withRaConnection } from "@/lib/ra/client";
import { attachDemandRecommendation, validateDemandRecommendation } from "@/lib/demand/store";

export const dynamic = "force-dynamic";
// Starts are explicitly selected per run; the app advances their saved steps automatically.
const schema = z.object({ requestId: z.string().uuid(), autonomous: z.literal(true), input: runSchema.and(z.object({ standardsRules: z.array(z.string().min(1).max(500)).max(20) })) });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const body = await readJson(request, schema);
    if (!body.input.text.trim() && !body.input.attachments?.some(a => a.text.trim() || a.fileId) && !body.input.sourceSolutionIds?.length) throw new ApiError("Add supported source content before starting an autonomous run");
    await assertImageOwnership(body.input, author);
    await assertAgentFileOwnership((body.input.attachments ?? []).flatMap(attachment => attachment.fileId ? [attachment.fileId] : []), author);
    // fileOwner is established here, never accepted from the browser payload.
    const input = { ...body.input, attachments: body.input.attachments?.map(attachment => attachment.fileId ? { ...attachment, fileOwner: author } : attachment) };
    if (input.demandRecommendationId) await validateDemandRecommendation(author, input.demandRecommendationId, input.demandSpecification);
    const id = `auto-${body.requestId}`;
    const existing = await getJob(id);
    const connection = await resolveConnection(author, input.connectionId);
    const groundContext = existing ? undefined : await withRaConnection(author, connection, () => resolveGroundContext(input.groundContext, input.sourceSolutionIds, author));
    const job = await enqueue(id, author, input, groundContext);
    if (input.demandRecommendationId) await attachDemandRecommendation(id, author, input.demandRecommendationId, input.demandSpecification);
    return json({ runId: job.runId, status: job.status }, 202);
  } catch (e) { return apiError(e); }
}
export async function GET(request: Request) {
  try {
    const author = await requireActor(request);
    const id = new URL(request.url).searchParams.get("runId");
    if (!id) {
      const latest = await latestJob(author);
      return json({ latest: latest ? { runId: latest.runId, status: latest.status } : undefined });
    }
    const job = await getJob(id);
    if (!job || job.author !== author) throw new ApiError("Run not found", 404);
    const run = await getRun(id);
    const execution = await loadExecution<ExecuteArgs>(id);
    const results = await executionResults(id);
    return json({ runId: id, status: job.status, stage: job.stage, updatedAt: job.updatedAt, error: job.error, authorization: job.authorization, costUsd: run?.costUsd ?? 0,
      outcome: await autonomousOutcome(job, run, execution, results),
      graph: execution ? buildSubmissionGraph(execution.plan, run?.snapshot?.candidates ?? run?.candidates, results, { ...execution, groups: run?.snapshot?.groups ?? run?.groups }) : undefined });
  } catch (e) { return apiError(e); }
}
