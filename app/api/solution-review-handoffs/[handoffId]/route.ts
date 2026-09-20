import { apiError, requireActor, ApiError } from "@/lib/api/auth";
import { getSolutionReviewHandoff } from "@/lib/ks/solution-reviews";
import { z } from "zod";

export const dynamic = "force-dynamic";
export async function GET(request: Request, context: RouteContext<"/api/solution-review-handoffs/[handoffId]">) {
  try {
    const { handoffId } = await context.params;
    if (!z.string().uuid().safeParse(handoffId).success) throw new ApiError("Invalid review handoff ID");
    return Response.json({ handoff: await getSolutionReviewHandoff(await requireActor(request), handoffId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
