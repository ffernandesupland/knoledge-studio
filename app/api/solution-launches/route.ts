import { requireActor, apiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { createSolutionLaunch } from "@/lib/ks/solution-launches";
import { z } from "zod";

export const dynamic = "force-dynamic";
const solutionId = z.string().regex(/^\d{15}$/);
const operation = z.enum(["Discover and suggest metadata", "Split topics", "Restructure content", "Apply content standards", "Find duplicates", "Optimize for search", "Find gaps"]);
const ids = z.array(solutionId).min(1).max(20).refine((value) => new Set(value).size === value.length, "Solution IDs must be unique");
const schema = z.object({
  solutionId, connectionId: z.string().max(100).optional(), sourceSolutionIds: ids.optional(),
  operations: z.array(operation).max(7).optional(), duplicateScopeIds: ids.optional(),
}).superRefine((value, ctx) => {
  if (value.duplicateScopeIds?.some((id) => ![value.solutionId, ...(value.sourceSolutionIds ?? [])].includes(id))) ctx.addIssue({ code: "custom", message: "Duplicate targets must be included in the selected solutions" });
});

export async function POST(request: Request) {
  try { return Response.json({ launch: await createSolutionLaunch(await requireActor(request), await readJson(request, schema)) }); }
  catch (error) { return apiError(error); }
}
