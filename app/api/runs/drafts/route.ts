import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { assertOwner } from "@/lib/api/validation";
import { getRun } from "@/lib/db/runs";
import { db } from "@/lib/db";

export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const runId = new URL(request.url).searchParams.get("runId");
    if (!runId || runId.length > 100) throw new ApiError("Choose a run");
    assertOwner(await getRun(runId), actor);
    const rows = await db().prepare("SELECT saved_at,payload FROM draft_history WHERE run_id=? ORDER BY id DESC LIMIT 50").all(runId) as { saved_at: string; payload: string }[];
    return Response.json({ versions: rows.map(r => ({ savedAt: r.saved_at, drafts: JSON.parse(r.payload).map((d: { key: string; prepared: string | null }) => ({ key: d.key, prepared: d.prepared ? JSON.parse(d.prepared) : null })) })) }, { headers: { "Cache-Control": "no-store", "Content-Disposition": "attachment; filename=previous-draft-versions.json" } });
  } catch (error) { return apiError(error); }
}
