import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { createSolutionReviewHandoff } from "@/lib/ks/solution-reviews";
import { z } from "zod";

export const dynamic = "force-dynamic";
const schema = z.object({ selectedFindingIndexes: z.array(z.number().int().nonnegative()).min(1).max(20) });

export async function POST(request: Request, context: RouteContext<"/api/solution-reviews/[reviewId]/handoffs">) {
  try {
    const { reviewId } = await context.params;
    if (!z.string().uuid().safeParse(reviewId).success) throw new Error("Invalid review ID");
    return Response.json({ handoff: await createSolutionReviewHandoff(await requireActor(request), reviewId, (await readJson(request, schema)).selectedFindingIndexes) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
