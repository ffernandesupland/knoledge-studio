import { z } from "zod";
import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { ra } from "@/lib/ra/client";
import { normalizeBaseUrl, normalizeToken, resolveConnection, type RaRuntimeConnection } from "@/lib/ra/connections";

export const dynamic = "force-dynamic";

const schema = z.object({
  id: z.string().max(100).optional(),
  baseUrl: z.string().trim().min(1).max(1000),
  bearerToken: z.string().max(10000).optional(),
  user: z.string().trim().min(1).max(200),
  companyCode: z.string().trim().min(1).max(200),
});

export async function POST(request: Request) {
  try {
    const owner = await requireActor(request);
    const input = await readJson(request, schema);
    const saved = input.id ? await resolveConnection(owner, input.id) : undefined;
    const bearerToken = input.bearerToken?.trim() ? normalizeToken(input.bearerToken) : saved?.bearerToken;
    if (!bearerToken) throw new ApiError("Enter a bearer token before testing the connection.");
    const connection: RaRuntimeConnection = {
      id: input.id ?? "connection-test",
      baseUrl: normalizeBaseUrl(input.baseUrl),
      bearerToken,
      user: input.user,
      companyCode: input.companyCode,
    };
    const templates = await ra.getTemplates({ connection });
    return Response.json({ ok: true, templateCount: templates.length }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
