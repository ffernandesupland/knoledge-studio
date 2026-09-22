import { z } from "zod";
import { apiError, requireActor } from "@/lib/api/auth";
import { demandSpecificationSchema, readJson } from "@/lib/api/validation";
import { recommendDemandPlan } from "@/lib/demand/plan";
import { createDemandRecommendation } from "@/lib/demand/store";

export const dynamic = "force-dynamic";

const schema = z.object({
  demandSpecification: demandSpecificationSchema,
  sourceSummary: z.string().max(150_000),
});

export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const input = await readJson(request, schema);
    const result = await recommendDemandPlan(input.demandSpecification, input.sourceSummary);
    const recommendation = await createDemandRecommendation({ author, specification: input.demandSpecification, sourceSummary: input.sourceSummary, recommendation: result.data, model: result.model });
    return Response.json({ recommendation });
  } catch (error) {
    return apiError(error);
  }
}
