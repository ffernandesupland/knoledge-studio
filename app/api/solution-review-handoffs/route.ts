import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { createSolutionReviewHandoffBatch } from "@/lib/ks/solution-reviews";
import { z } from "zod";

export const dynamic = "force-dynamic";
const schema = z.object({ selections: z.array(z.object({ reviewId: z.string().uuid(), selectedFindingIndexes: z.array(z.number().int().nonnegative()).min(1).max(20) })).min(1).max(20) });

export async function POST(request: Request) {
  try { return Response.json({ handoff: await createSolutionReviewHandoffBatch(await requireActor(request), (await readJson(request, schema)).selections) }, { status: 201 }); }
  catch (error) { return apiError(error); }
}
