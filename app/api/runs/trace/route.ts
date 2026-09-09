import { requireActor, apiError } from "@/lib/api/auth";
import { assertOwner } from "@/lib/api/validation";
import { db } from "@/lib/db";
import { getRun } from "@/lib/db/runs";
import { executionResults } from "@/lib/pipeline/state";

export async function GET(request: Request) {
  try {
    const user = await requireActor(request);
    const run = (await getRun(new URL(request.url).searchParams.get("runId") ?? ""));
    assertOwner(run, user);
    const calls = (await db().prepare(`SELECT id, phase, ts, operation, model, input_tokens AS inputTokens,
      output_tokens AS outputTokens, cost_usd AS costUsd, prompt_version AS promptVersion, request, response
      FROM ai_calls WHERE run_id=? ORDER BY id`).all(run.id));
    return Response.json({ runId: run.id, status: run.status, costUsd: run.costUsd, steps: run.steps, calls, results: (await executionResults(run.id)) }, { headers: { "cache-control": "no-store" } });
  } catch (e) { return apiError(e); }
}
