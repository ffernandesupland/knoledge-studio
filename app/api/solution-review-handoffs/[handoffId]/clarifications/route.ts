import { apiError, requireActor, ApiError } from "@/lib/api/auth";
import { generateSolutionReviewHandoffClarifications } from "@/lib/ks/solution-reviews";
import { z } from "zod";

export const dynamic = "force-dynamic";

export async function POST(request: Request, context: RouteContext<"/api/solution-review-handoffs/[handoffId]/clarifications">) {
  try {
    const { handoffId } = await context.params;
    if (!z.string().uuid().safeParse(handoffId).success) throw new ApiError("Invalid review handoff ID");
    return Response.json({ handoff: await generateSolutionReviewHandoffClarifications(await requireActor(request), handoffId) });
  } catch (error) { return apiError(error); }
}
