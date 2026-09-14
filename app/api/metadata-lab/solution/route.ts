import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { ra } from "@/lib/ra/client";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const url = new URL(request.url);
    const id = url.searchParams.get("id");
    if (id) {
      if (!/^[\w-]{1,100}$/.test(id)) throw new ApiError("Enter a valid solution ID");
      const [solution, collections] = await Promise.all([ra.getSolution(id, { impUser: actor }), ra.getCollections({ impUser: actor })]);
      if (!solution?.id) throw new ApiError("Solution not found", 404);
      return Response.json({ solution, collectionLabels: Object.fromEntries(collections.map(c => [c.code, c.displayName || c.code])) }, { headers: { "Cache-Control": "no-store" } });
    }
    const q = url.searchParams.get("q")?.trim() ?? "";
    const page = Number(url.searchParams.get("page") ?? 1);
    if (!q || q.length > 300 || !Number.isInteger(page) || page < 1 || page > 100) throw new ApiError("Enter a search query of up to 300 characters and a valid page");
    const result = await ra.search({ queryText: q, page, searchType: "Hybrid", verboseResult: true, verboseResultFields: "title,summary,status", loggingEnabled: false }, { impUser: actor });
    return Response.json({ rows: result.solutions.map(s => ({ id: s.id, title: s.title, summary: (s.summary ?? "").slice(0, 600), status: s.verboseSolutionResult?.status ?? "" })), totalHits: result.totalHits }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
