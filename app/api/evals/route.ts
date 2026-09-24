import { z } from "zod";
import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { readJson, assertOwner } from "@/lib/api/validation";
import { getRun } from "@/lib/db/runs";
import { withAiAudit } from "@/lib/llm/audit";
import { evaluatePreparedDraft } from "@/lib/evals/service";
import { listEvalDashboard } from "@/lib/evals/store";
import { getWriteState, loadExecution } from "@/lib/pipeline/state";
import type { ExecuteArgs } from "@/lib/pipeline/execute";

export const dynamic = "force-dynamic";
const requestSchema = z.object({ runId: z.string().min(1).max(160), idempotencyKey: z.string().min(1).max(200) });
const json = (data: unknown, status = 200) => Response.json(data, { status, headers: { "cache-control": "no-store" } });

export async function GET(request: Request) {
  try {
    const author = await requireActor(request);
    return json({ rubrics: await listEvalDashboard(author) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const body = await readJson(request, requestSchema);
    const run = await getRun(body.runId);
    assertOwner(run, author);
    const execution = await loadExecution<ExecuteArgs>(run.id);
    if (!execution) throw new ApiError("Prepare this draft before requesting an evaluation", 409);
    const state = await getWriteState(body.idempotencyKey);
    const prepared = state?.prepared;
    if (!prepared) throw new ApiError("The prepared draft is no longer available", 409);
    return json(await withAiAudit(run.id, "evaluation", () => evaluatePreparedDraft({ run, execution, idempotencyKey: body.idempotencyKey, prepared })));
  } catch (error) { return apiError(error); }
}
