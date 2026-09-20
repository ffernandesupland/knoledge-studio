import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { createSolutionReviewDefinition, listSolutionReviewDefinitions, solutionReviewDefinitionInput } from "@/lib/ks/solution-reviews";
import { z } from "zod";

export const dynamic = "force-dynamic";
const createSchema = z.object({ connectionId: z.string().max(100).optional(), name: z.string(), objective: z.string() });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return Response.json({ definitions: await listSolutionReviewDefinitions(await requireActor(request), url.searchParams.get("connectionId") ?? undefined) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const input = await readJson(request, createSchema);
    const definition = await createSolutionReviewDefinition(await requireActor(request), input.connectionId, solutionReviewDefinitionInput.parse(input));
    return Response.json({ definition }, { status: 201 });
  } catch (error) { return apiError(error); }
}
