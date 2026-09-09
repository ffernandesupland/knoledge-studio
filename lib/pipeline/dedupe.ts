import { z } from "zod";
import { runOperation } from "../llm/client";
import type { UntrustedBlock } from "../llm/prompt";
import { ra } from "../ra/client";
import type { WSSolution } from "../ra/types";

/* ── Schemas ──────────────────────────────────────────────────────────────── */

export const QuerySchema = z.object({
  query: z.string(),
  rationale: z.string(),
});

export const MatchSchema = z.object({
  matches: z.array(
    z.object({
      solutionId: z.string(),
      sameUserNeed: z.boolean(),
      verdict: z.enum(["duplicate", "overlapping", "distinct"]),
      /** Adjudicated 0-100. Never a raw search score — those are unusable (finding V1). */
      similarity: z.number().min(0).max(100),
      rationale: z.string(),
      sharedTopics: z.array(z.string()),
    }),
  ),
});
export type MatchResult = z.infer<typeof MatchSchema>;

export const BatchOverlapSchema = z.object({
  pairs: z.array(
    z.object({
      aIndex: z.number().int(),
      bIndex: z.number().int(),
      sameUserNeed: z.boolean(),
      verdict: z.enum(["duplicate", "overlapping", "distinct"]),
      similarity: z.number().min(0).max(100),
      rationale: z.string(),
    }),
  ),
});

const INTENT_RUBRIC = `First identify the primary reader question or task answered by each item.
Return sameUserNeed=true ONLY when the items answer the same question or accomplish the same task
for the same audience and applicable environment. When uncertain, return false and keep them separate.
Shared product names, copied prerequisites, introductions, navigation, tool lists or shared source documents
are not evidence of the same user need. An overview of available tools and instructions for configuring
tool availability are distinct needs. Source-mapping configuration and usage-dashboard reporting are
also distinct needs. Related concepts may warrant cross-links, not merging.
For overlapping items, explain which substantive answer or procedure is duplicated and what unique
information each contributes. If their primary needs differ, sameUserNeed must be false even when
substantial background text is shared. A high similarity score alone cannot recommend merging.
Do not infer duplicate intent from titles alone; verify against the full content.`;

/* ── Helpers ──────────────────────────────────────────────────────────────── */

export interface Candidate {
  key: string;
  title: string;
  body: string;
}

export function solutionToText(s: WSSolution): string {
  const fields = (s.fields ?? [])
    .filter((f) => f.content?.trim())
    .map((f) => `## ${f.name}\n${f.content.trim()}`)
    .join("\n\n");
  return [s.title, s.summary, fields].filter(Boolean).join("\n\n");
}

/**
 * Per-run cache. Candidates in one batch surface overlapping neighbours constantly, so the
 * same solution would otherwise be fetched many times over.
 */
export class SolutionCache {
  private store = new Map<string, Promise<WSSolution>>();
  constructor(private readonly concurrency = 4) {}
  private active = 0;
  private queue: (() => void)[] = [];

  private async slot<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.concurrency) {
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }

  get(id: string): Promise<WSSolution> {
    let hit = this.store.get(id);
    if (!hit) {
      hit = this.slot(() => ra.getSolution(id));
      this.store.set(id, hit);
    }
    return hit;
  }

  get size(): number {
    return this.store.size;
  }
}

/* ── Steps ────────────────────────────────────────────────────────────────── */

/** Titles are often the least distinctive part, so the query is written from the body. */
export async function generateSearchQuery(candidate: Candidate) {
  const res = await runOperation({
    operation: "dedupeQuery",
    schemaName: "search_query",
    schema: QuerySchema,
    role: "You write retrieval queries that surface existing articles covering the same topic.",
    task: `Write one search query that would find existing knowledge-base articles about the same
subject as the content above. Use the distinctive technical terms from the body, not just the
title. Return a plain query string, no operators or quotes.`,
    blocks: [
      { label: "title", content: candidate.title },
      { label: "body", content: candidate.body },
    ],
  });
  return { query: res.data.query, costUsd: res.costUsd };
}

export interface DuplicateMatch {
  solutionId: string;
  title: string;
  sameUserNeed?: boolean;
  verdict: "duplicate" | "overlapping" | "distinct";
  similarity: number;
  rationale: string;
  sharedTopics: string[];
  viewCount: number;
}

export interface DedupeOptions {
  recallLimit?: number;
  fetchLimit?: number;
  cache?: SolutionCache;
  /** Solution IDs to ignore, e.g. the candidate's own source record. */
  exclude?: Set<string>;
  collection?: string;
  language?: string;
}

/**
 * Search-and-adjudicate. RA has no similarity endpoint and its Neural scores are normalised
 * into a ~0.01-wide band (an unrelated Outlook article scored 0.9885 on a VPN query), so recall
 * comes from search and judgement comes from the model. See ARCHITECTURE.md §5 and finding V1.
 */
export async function findDuplicatesFor(
  candidate: Candidate,
  opts: DedupeOptions = {},
): Promise<{ matches: DuplicateMatch[]; costUsd: number; model?: string }> {
  const { recallLimit = 10, fetchLimit = 8, cache = new SolutionCache(), exclude } = opts;

  const { query, costUsd: queryCost } = await generateSearchQuery(candidate);
  const search = await ra.search({
    queryText: query,
    collections: opts.collection, language: opts.language,
    searchType: "Neural",
    verboseResult: true,
    verboseResultFields: "title,status,view_count,template_name",
    page: 1,
  });

  const ids = search.solutions
    .map((s) => s.id)
    .filter((id) => !exclude?.has(id))
    .slice(0, recallLimit)
    .slice(0, fetchLimit);
  if (!ids.length) return { matches: [], costUsd: queryCost };

  const fetched = await Promise.all(ids.map((id) => cache.get(id)));
  const neighbours = fetched.filter((s): s is WSSolution => !!s);
  if (!neighbours.length) return { matches: [], costUsd: queryCost };

  const res = await adjudicateDuplicates(candidate, neighbours);

  const byId = new Map(neighbours.map((s) => [s.id, s]));
  if (new Set(res.data.matches.map((m) => m.solutionId)).size !== neighbours.length || res.data.matches.length !== neighbours.length || res.data.matches.some((m) => !byId.has(m.solutionId))) throw new Error("Duplicate adjudication did not return one verdict per retrieved article");
  const matches = res.data.matches
    .filter((m) => byId.has(m.solutionId) && m.verdict !== "distinct")
    .map((m) => {
      const s = byId.get(m.solutionId)!;
      return {
        solutionId: m.solutionId,
        title: s.title,
        sameUserNeed: m.sameUserNeed,
        verdict: m.verdict,
        similarity: m.similarity,
        rationale: m.rationale,
        sharedTopics: m.sharedTopics,
        viewCount: s.viewCount ?? 0,
      };
    })
    .sort((a, b) => b.similarity - a.similarity);

  return { matches, costUsd: queryCost + res.costUsd, model: res.model };
}

/**
 * Newly generated candidates are not in the knowledge base yet, so search cannot find them.
 * One self-comparison call covers the whole batch.
 */
export async function findIntraBatchOverlaps(candidates: Candidate[]) {
  if (candidates.length < 2) return { pairs: [], costUsd: 0 };
  const res = await runOperation({
    operation: "dedupeAdjudicate",
    schemaName: "batch_overlaps",
    schema: BatchOverlapSchema,
    role: "You detect overlap between newly drafted articles in the same batch.",
    task: `Compare every pair of drafts above. Indices are zero-based in the order given.
Return only pairs that are "duplicate" or "overlapping"; omit distinct pairs entirely.
Duplicate = same problem and same resolution. Overlapping = meaningful shared content with unique details.
Distinct = different problem or resolution despite shared vocabulary. Similarity is confidence in
same-topic coverage from 0–100, based on the problem AND resolution, not shared words.
Only sameUserNeed=true AND a score of 80 or more recommends human duplicate review.
${INTENT_RUBRIC}`,
    blocks: candidates.map((c, i) => ({
      label: `draft ${i}: ${c.title}`,
      content: c.body,
    })),
  });
  if (res.data.pairs.some((p) => p.aIndex < 0 || p.bIndex < 0 || p.aIndex >= candidates.length || p.bIndex >= candidates.length || p.aIndex === p.bIndex)) throw new Error("Invalid draft pair returned by duplicate adjudication");
  return {
    pairs: res.data.pairs.filter((p) => p.verdict !== "distinct"),
    costUsd: res.costUsd,
    model: res.model,
  };
}

export function adjudicateDuplicates(candidate: Candidate, neighbours: WSSolution[]) {
  const blocks: UntrustedBlock[] = [
    { label: "candidate", content: `${candidate.title}\n\n${candidate.body}` },
    ...neighbours.map((s) => ({
      label: `existing solution ${s.id}`,
      content: solutionToText(s),
    })),
  ];

  return runOperation({
    operation: "dedupeAdjudicate",
    schemaName: "duplicate_matches",
    schema: MatchSchema,
    role: "You decide whether knowledge-base articles genuinely cover the same topic.",
    task: `Compare the candidate against each existing solution above.

For every existing solution return one entry using its id exactly as given in the label.
- "duplicate": same problem and same resolution; one article should replace the other.
- "overlapping": meaningful shared content but each covers something the other does not.
- "distinct": different topics, even if they share vocabulary or a product name.

"similarity" is your confidence that they cover the same topic, 0-100. Judge by problem and
resolution, not by shared words: two articles about different problems on the same product are
distinct. "rationale" explains the primary user needs and the concrete answer overlap.
${INTENT_RUBRIC}`,
    blocks,
  });

}
