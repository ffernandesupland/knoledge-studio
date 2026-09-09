import { z } from "zod";
import { discardResumableRun, getResumableRun, getRun, saveSnapshot } from "@/lib/db/runs";
import { requireActor, apiError } from "@/lib/api/auth";
import { assertOwner, canonicalSnapshot, readJson } from "@/lib/api/validation";
import { executionResults, loadExecution } from "@/lib/pipeline/state";
import type { ExecuteArgs } from "@/lib/pipeline/execute";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const run = (await getResumableRun(await requireActor(request)));
    return Response.json({ run, execution: run ? (await loadExecution<ExecuteArgs>(run.id)) : undefined, results: run ? (await executionResults(run.id)) : [] });
  } catch (e) { return apiError(e); }
}
export async function DELETE(request: Request) {
  try { (await discardResumableRun(await requireActor(request))); return Response.json({ ok: true }); }
  catch (e) { return apiError(e); }
}
export async function PATCH(request: Request) {
  try {
    const user = await requireActor(request);
    const body = await readJson(request, z.object({ runId: z.string().max(100), snapshot: z.unknown() }));
    const run = (await getRun(body.runId));
    assertOwner(run, user);
    if ((await loadExecution(run.id))) return Response.json({ ok: true, frozen: true });
    (await saveSnapshot(run.id, canonicalSnapshot(run, body.snapshot)));
    return Response.json({ ok: true });
  } catch (e) { return apiError(e); }
}
