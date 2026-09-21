import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { listSolutionReviews, runSolutionReview } from "@/lib/ks/solution-reviews";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const schema = z.object({ connectionId: z.string().max(100).optional(), solutionId: z.string().regex(/^\d{15}$/), definitionId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const solutionId = url.searchParams.get("solutionId") ?? "";
    if (!/^\d{15}$/.test(solutionId)) throw new Error("Enter a valid 15-digit solution ID");
    return Response.json({ reviews: await listSolutionReviews(await requireActor(request), { connectionId: url.searchParams.get("connectionId") ?? undefined, solutionId }) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try { return Response.json({ review: await runSolutionReview(await requireActor(request), await readJson(request, schema)) }); }
  catch (error) { return apiError(error); }
}
