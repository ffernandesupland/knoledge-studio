import { requireActor, apiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { withRaConnection, ra } from "@/lib/ra/client";
import { resolveConnection } from "@/lib/ra/connections";
import { adjudicateDuplicates, findDuplicatesFor, SolutionCache, solutionToText } from "@/lib/pipeline/dedupe";
import type { WSSolution } from "@/lib/ra/types";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const solutionId = z.string().regex(/^\d{15}$/);
const schema = z.object({
  solutionId,
  connectionId: z.string().max(100).optional(),
  /** Omit for KB-wide retrieval. Supply IDs to compare only against that selected subset. */
  candidateIds: z.array(solutionId).min(1).max(19).refine((ids) => new Set(ids).size === ids.length, "Candidate IDs must be unique").optional(),
});

function row(solution: WSSolution, match: { verdict: "duplicate" | "overlapping" | "distinct"; similarity: number; rationale: string; sharedTopics: string[] }) {
  return {
    solutionId: solution.id,
    title: solution.title,
    summary: solution.summary ?? "",
    author: solution.author ?? "—",
    status: solution.status,
    collections: solution.collections ?? [],
    viewCount: solution.viewCount ?? 0,
    ...match,
  };
}

/**
 * Read-only duplicate preview for AI Solution View. A selected candidate list is an explicit
 * comparison boundary: it never falls back to KB retrieval.
 */
export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const input = await readJson(request, schema);
    const connection = await resolveConnection(author, input.connectionId);
    return Response.json(await withRaConnection(author, connection, async () => {
      const source = await ra.getSolution(input.solutionId);
      if (source.id !== input.solutionId) throw new Error("Solution not found");
      const candidate = { key: source.id, title: source.title, body: solutionToText(source) };
      const cache = new SolutionCache();

      if (input.candidateIds?.length) {
        const ids = input.candidateIds.filter((id) => id !== source.id);
        const neighbours = await Promise.all(ids.map((id) => cache.get(id)));
        const result = await adjudicateDuplicates(candidate, neighbours);
        const byId = new Map(neighbours.map((solution) => [solution.id, solution]));
        return {
          scope: "selected" as const,
          comparedIds: ids,
          costUsd: result.costUsd,
          matches: result.data.matches.map((match) => row(byId.get(match.solutionId)!, match)).sort((a, b) => b.similarity - a.similarity),
        };
      }

      const result = await findDuplicatesFor(candidate, { cache, exclude: new Set([source.id]) });
      const solutions = await Promise.all(result.matches.map((match) => cache.get(match.solutionId)));
      const byId = new Map(solutions.map((solution) => [solution.id, solution]));
      return {
        scope: "knowledge-base" as const,
        comparedIds: result.retrieval,
        costUsd: result.costUsd,
        matches: result.matches.map((match) => row(byId.get(match.solutionId)!, match)),
      };
    }));
  } catch (error) { return apiError(error); }
}
