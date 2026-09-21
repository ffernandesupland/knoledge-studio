import { apiError, requireActor, ApiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { resolveSolutionReviewHandoff } from "@/lib/ks/solution-reviews";
import { z } from "zod";

export const dynamic = "force-dynamic";
const schema = z.object({ answers: z.array(z.object({ questionKey: z.string().min(1).max(200), choice: z.string().min(1).max(300), finalInformation: z.string().trim().min(1).max(4_000) })).min(1).max(20) });

export async function POST(request: Request, context: RouteContext<"/api/solution-review-handoffs/[handoffId]/resolutions">) {
  try {
    const { handoffId } = await context.params;
    if (!z.string().uuid().safeParse(handoffId).success) throw new ApiError("Invalid review handoff ID");
    return Response.json({ handoff: await resolveSolutionReviewHandoff(await requireActor(request), handoffId, (await readJson(request, schema)).answers) });
  } catch (error) { return apiError(error); }
}
