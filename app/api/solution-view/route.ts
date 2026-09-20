import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { solutionVersion } from "@/lib/pipeline/version";
import { ra } from "@/lib/ra/client";
import { resolveConnection } from "@/lib/ra/connections";

export const dynamic = "force-dynamic";

/** Returns the saved solution used by AI Solution View. Browser edits are never treated as source evidence. */
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id") ?? "";
    if (!/^\d{15}$/.test(id)) throw new ApiError("Enter a valid 15-digit solution ID");
    const connection = await resolveConnection(actor, url.searchParams.get("connectionId"));
    const solution = await ra.getSolution(id, { impUser: actor, connection });
    if (solution.id !== id) throw new ApiError("Solution not found", 404);
    return Response.json({ solution, connectionId: connection.id, version: solutionVersion(solution) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
