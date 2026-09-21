import { requireActor, apiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { createSolutionLaunch } from "@/lib/ks/solution-launches";
import { z } from "zod";

export const dynamic = "force-dynamic";
const schema = z.object({ solutionId: z.string().regex(/^\d{15}$/), connectionId: z.string().max(100).optional() });

export async function POST(request: Request) {
  try { return Response.json({ launch: await createSolutionLaunch(await requireActor(request), await readJson(request, schema)) }); }
  catch (error) { return apiError(error); }
}
