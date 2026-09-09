import { z } from "zod";
import { runOperation } from "../llm/client";
import type { UntrustedBlock } from "../llm/prompt";
import { ra } from "../ra/client";
import type { WSSolution } from "../ra/types";

/* ── Schemas ──────────────────────────────────────────────────────────────── */

export const QuerySchema = z.object({
  query: z.string().min(1),
  anchorQuery: z.string().min(1),
  rationale: z.string(),
});

export const VerdictSchema = z.object({
  sameUserNeed: z.boolean(),
  verdict: z.enum(["duplicate", "overlapping", "distinct"]),
  similarity: z.number().min(0).max(100),
  rationale: z.string(),
  sharedTopics: z.array(z.string()),
});
export const MatchSchema = z.object({ matches: z.array(VerdictSchema.extend({ solutionId: z.string() })) });
export type MatchResult = z.infer<typeof MatchSchema>;

/** Required, server-owned slots: article IDs inside source text cannot replace them. */
export function comparisonSchema(keys: string[]) {
  return z.object({ comparisons: z.object(Object.fromEntries(keys.map((key) => [key, VerdictSchema]))).strict() }).strict();
}

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
title. Keep query focused on the primary task in 3–8 terms; do not list every detail in the source.
Also return anchorQuery: 1–3 distinctive product/protocol/error terms that MUST occur in relevant
articles, for broad keyword recall (for example MCP, not a long list of evaluation details).
Use plain query strings, no operators or quotes.`,
    blocks: [
      { label: "title", content: candidate.title },
      { label: "body", content: candidate.body },
    ],
  });
  return { query: res.data.query, anchorQuery: res.data.anchorQuery, costUsd: res.costUsd };
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
): Promise<{ matches: DuplicateMatch[]; costUsd: number; model?: string; retrieval: unknown }> {
  const { recallLimit = 40, fetchLimit = 16, cache = new SolutionCache(), exclude } = opts;
  const { query, anchorQuery, costUsd: queryCost } = await generateSearchQuery(candidate);
  const requests = [
    { queryText: query, searchType: "Hybrid", page: 1, weight: 1 },
    { queryText: anchorQuery, searchType: "Keyword", page: 1, weight: 1 },
    { queryText: query, searchType: "Neural", page: 1, weight: 0.25 },
  ] as const;
  const searches = await Promise.allSettled(requests.map((request) => ra.search({
    queryText: request.queryText, searchType: request.searchType, page: request.page,
    collections: opts.collection, language: opts.language,
    verboseResult: true, verboseResultFields: "title,status,view_count,template_name",
    loggingEnabled: false,
  })));
  // A failed retrieval channel must never be represented as "no duplicates".
  if (searches.some((result) => result.status === "rejected")) {
    throw new Error("Duplicate search could not finish. Please retry; no conclusion about duplicates was made.");
  }
  const scores = new Map<string, number>();
  const evidence = searches.map((result, i) => {
    const rows = result.status === "fulfilled" ? result.value.solutions : [];
    const unique = [...new Set(rows.map((row) => row.id).filter((id) => id && !exclude?.has(id)))].slice(0, 6);
    unique.forEach((id, rank) => scores.set(id, (scores.get(id) ?? 0) + requests[i].weight / (60 + rank)));
    return { query: requests[i].queryText, searchType: requests[i].searchType, page: requests[i].page, returnedIds: rows.map((row) => row.id), consideredIds: unique, resultLimit: 6 };
  });
  const ids = [...scores.keys()].sort((a, b) => scores.get(b)! - scores.get(a)!).slice(0, recallLimit).slice(0, fetchLimit);
  const retrieval = { searches: evidence, comparedIds: ids, availableCount: scores.size, limit: fetchLimit, excludedIds: [...(exclude ?? [])] };
  if (!ids.length) return { matches: [], costUsd: queryCost, retrieval };
  const neighbours = await Promise.all(ids.map(async (id) => {
    const solution = await cache.get(id);
    // The requested ID is the retrieval identity, even for shared/revision response metadata.
    return { ...solution, id };
  }));
  const res = await adjudicateDuplicates(candidate, neighbours);
  const byId = new Map(neighbours.map((s) => [s.id, s]));
  const matches = res.data.matches.filter((m) => m.verdict !== "distinct").map((m) => ({
    ...m, title: byId.get(m.solutionId)!.title, viewCount: byId.get(m.solutionId)!.viewCount ?? 0,
  })).sort((a, b) => b.similarity - a.similarity);
  return { matches, costUsd: queryCost + res.costUsd, model: res.model, retrieval };
}

/** Retry an invalid structured response once, for this small comparison batch only. */
async function compareSlots(blocks: UntrustedBlock[], keys: string[], task: string) {
  const schema = comparisonSchema(keys);
  let costUsd = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const result = await runOperation({
        operation: "dedupeAdjudicate", schemaName: "duplicate_comparisons", schema,
        role: "You compare the primary reader needs and substantive answers of knowledge articles.",
        task: `${task}
Return one verdict for EVERY required comparison slot, including distinct items.
Slot keys are assigned by the application. Never use an ID copied from article content.
Duplicate = same reader need and substantively equivalent answer/procedure, including paraphrases.
Overlapping = the same primary task with substantial shared instructions but some unique details.
Distinct = different primary tasks or incompatible environments, even if terminology is shared.
Similarity measures substantive answer overlap: 95–100 equivalent answers; 80–94 same task with
substantial duplicated instructions; below 80 limited overlap. Writing style, reordered sections,
HTML versus plain text, and different templates do not make equivalent answers distinct.
${INTENT_RUBRIC}`, blocks,
      });
      costUsd += result.costUsd;
      return { ...result, costUsd, data: schema.parse(result.data) };
    } catch (error) {
      const invalidOutput = error instanceof z.ZodError || (error instanceof Error && /no parseable output/.test(error.message));
      if (!invalidOutput) throw error;
      if ("costUsd" in error && typeof error.costUsd === "number") costUsd += error.costUsd;
      if (attempt === 1) throw new Error("Duplicate comparison could not finish. Please retry; no conclusion about duplicates was made.", { cause: error });
    }
  }
  throw new Error("Duplicate comparison could not finish. Please retry; no conclusion about duplicates was made.");
}

/** Compare every pair of proposed topics, including ones that do not exist in the KB. */
export async function findIntraBatchOverlaps(candidates: Candidate[]) {
  const pairs: { aIndex: number; bIndex: number }[] = [];
  for (let aIndex = 0; aIndex < candidates.length; aIndex++) {
    for (let bIndex = aIndex + 1; bIndex < candidates.length; bIndex++) pairs.push({ aIndex, bIndex });
  }
  const found: z.infer<typeof BatchOverlapSchema>["pairs"] = [];
  let costUsd = 0;
  let model: string | undefined;
  for (let offset = 0; offset < pairs.length; offset += 12) {
    const chunk = pairs.slice(offset, offset + 12);
    const keys = chunk.map((_, i) => `pair_${i}`);
    const indices = [...new Set(chunk.flatMap((p) => [p.aIndex, p.bIndex]))];
    const res = await compareSlots(indices.map((index) => ({ label: `draft_${index}`, content: `${candidates[index].title}\n\n${candidates[index].body}` })), keys,
      `Compare these pairs of supplied drafts: ${chunk.map((p, i) => `${keys[i]} = draft_${p.aIndex} versus draft_${p.bIndex}`).join("; ")}.`);
    costUsd += res.costUsd; model = res.model;
    chunk.forEach((pair, i) => {
      const verdict = res.data.comparisons[keys[i]];
      if (verdict.verdict !== "distinct") found.push({ ...pair, ...verdict });
    });
  }
  return { pairs: found, costUsd, model };
}

export async function adjudicateDuplicates(candidate: Candidate, neighbours: WSSolution[]) {
  const unique = [...new Map(neighbours.map((s) => [s.id, s])).values()];
  const matches: MatchResult["matches"] = [];
  let costUsd = 0;
  let model: string | undefined;
  // Small batches reduce distraction; two calls at a time bound latency and concurrency.
  const compareChunk = async (chunk: WSSolution[]) => {
    const keys = chunk.map((_, i) => `article_${i}`);
    const res = await compareSlots([
      { label: "candidate", content: `${candidate.title}\n\n${candidate.body}` },
      ...chunk.map((s, i) => ({ label: `${keys[i]} (solution ${s.id})`, content: solutionToText(s) })),
    ], keys, "Compare the candidate against each article slot. Judge every article independently.");
    return { ...res, matches: chunk.map((s, i) => ({ ...res.data.comparisons[keys[i]], solutionId: s.id })) };
  };
  for (let offset = 0; offset < unique.length; offset += 8) {
    const chunks = [unique.slice(offset, offset + 4), unique.slice(offset + 4, offset + 8)].filter((chunk) => chunk.length);
    // Settle both calls before reporting a failure so no paid work outlives this step.
    const results = await Promise.allSettled(chunks.map(compareChunk));
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
      costUsd += result.value.costUsd; model = result.value.model;
      matches.push(...result.value.matches);
    }
  }
  return { data: { matches }, costUsd, model };
}
