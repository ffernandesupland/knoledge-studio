import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { ra } from "@/lib/ra/client";
import { referenceFromSolution } from "@/lib/ground-context/server";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    if (!/^\d{15}$/.test(id)) throw new ApiError("Enter a valid solution ID");
    const solution = await ra.getSolution(id, { impUser: actor });
    if (solution.id !== id) throw new ApiError("Reference not found", 404);
    return Response.json({ reference: referenceFromSolution(solution) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}