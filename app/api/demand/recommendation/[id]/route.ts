import { z } from "zod";
import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { setDemandRecommendationStatus } from "@/lib/demand/store";

export const dynamic = "force-dynamic";

const schema = z.object({ status: z.enum(["accepted", "dismissed"]) });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const author = await requireActor(request);
    const input = await readJson(request, schema);
    const { id } = await context.params;
    return Response.json({ recommendation: await setDemandRecommendationStatus(author, id, input.status) });
  } catch (error) {
    return apiError(error);
  }
}
