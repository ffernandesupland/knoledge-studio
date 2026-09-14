import { sourceContext } from "../llm/source-context";
import { z } from "zod";
import { ra, type RaContext } from "../ra/client";
import { isLive } from "../ra/status";
import type { WSSolution } from "../ra/types";
import { runOperation } from "../llm/client";
import type { MetadataOption, MetadataReport, MetadataExample } from "./types";

const normalize = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const unique = <T,>(values: T[]) => [...new Set(values)];
export function shortlist<T>(items: T[], text: (item: T) => string, query: string, limit: number): T[] {
  const words = unique(normalize(query).split(" ").filter(w => w.length > 2));
  return items.map((item, index) => ({ item, index, score: words.reduce((n, w) => n + (normalize(text(item)).includes(w) ? 1 : 0), 0) }))
    .sort((a, b) => b.score - a.score || a.index - b.index).slice(0, limit).map(v => v.item);
}
export function sourceText(solution: WSSolution) {
  const fields = solution.fields ?? [];
  const budget = Math.floor(32000 / Math.max(1, fields.length));
  return [solution.title.slice(0, 2000), (solution.summary ?? "").slice(0, 4000), ...fields.map(f => `${f.name}: ${f.content.slice(0, budget)}`)].join("\n\n");
}
export function usableExamples(solutions: WSSolution[], target: WSSolution): WSSolution[] {
  const ids = new Set<string>(), titles = new Set<string>();
  return solutions.filter(s => {
    const title = normalize(s.title);
    if (!isLive(s.status) || !s.id || s.id === target.id || s.id === target.revisionID || s.revisionID === target.id || title === normalize(target.title) || ids.has(s.id) || titles.has(title)) return false;
    ids.add(s.id); titles.add(title); return true;
  }).slice(0, 12);
}
export const RecommendationSchema = z.object({
  rationale: z.string().max(1200),
  suggestions: z.array(z.object({ candidateId: z.string(), reason: z.string().max(600), sourceEvidence: z.string().max(500), exampleIds: z.array(z.string()).max(4) })).max(12),
  uncertainties: z.array(z.string().max(500)).max(8),
});
export function validateRecommendations(data: z.infer<typeof RecommendationSchema>, options: MetadataOption[], examples: MetadataExample[], target: WSSolution) {
  const used = new Set<string>();
  return data.suggestions.map(s => {
    const option = options.find(o => o.id === s.candidateId);
    if (!option || used.has(option.id)) throw new Error("The model returned an unknown or repeated metadata option. Run the analysis again.");
    used.add(option.id);
    if (s.exampleIds.some(id => !examples.some(e => e.id === id))) throw new Error("The model referenced an example outside this research. Run the analysis again.");
    if (!normalize(s.sourceEvidence) || !normalize(sourceText(target)).includes(normalize(s.sourceEvidence))) throw new Error("A suggestion did not cite a matching excerpt from the solution. Run the analysis again.");
    const current = option.kind === "collection" ? target.collections ?? [] : option.kind === "taxonomy" ? target.taxonomy ?? [] : target.attributes?.find(a => a.name === option.attributeName)?.values ?? [];
    return { option, reason: s.reason, sourceEvidence: s.sourceEvidence, exampleIds: unique(s.exampleIds), alreadyAssigned: current.includes(option.value) };
  });
}

/** Read-only prototype. Every RA operation is scoped to the requesting actor; no shared catalog cache. */
export async function analyzeMetadata(id: string, ctx: RaContext, progress: (message: string) => void = () => {}, signal?: AbortSignal): Promise<MetadataReport> {
  return analyzeMetadataSource(await ra.getSolution(id, ctx), ctx, progress, signal);
}

export async function analyzeMetadataSource(target: WSSolution, ctx: RaContext, progress: (message: string) => void = () => {}, signal?: AbortSignal): Promise<MetadataReport> {
  const check = () => { if (signal?.aborted) throw new Error("Analysis cancelled"); };
  const usage = { inputTokens: 0, outputTokens: 0, costUsd: 0 };
  const account = (r: { inputTokens: number; outputTokens: number; costUsd: number }) => { usage.inputTokens += r.inputTokens; usage.outputTokens += r.outputTokens; usage.costUsd += r.costUsd; };
  const limitations = ["Taxonomy research covers selected searchable branches, not the complete administrative catalog or empty categories.", "Collections are searchable destinations; publishing permissions have not been verified.", "Attribute values are observed examples, not a validated administrative list. Suggestions require review.", sourceContext().length ? "Original pipeline sources are available for context; classification concerns this resulting article only." : "This prototype analyzes solution text. Embedded image pixels and attached documents are not fetched."];
  progress("Reading the solution and identifying its subject…");
  check();
  if (!target?.id || !target.title) throw new Error("Solution was not found or is not accessible.");
  const content = sourceText(target);
  if ((target.fields ?? []).some(f => f.content.length > Math.floor(32000 / Math.max(1, target.fields?.length ?? 0)))) limitations.push("Long solution fields were shortened for analysis; verify suggestions against the full article.");
  const plan = await runOperation({ operation: "metadataExplore", schemaName: "metadata_search_plan", role: "Identify a knowledge article's subject for metadata research.",
    task: "Return 2 concise search queries (maximum 180 characters each) preserving product names, plus up to 12 topic/product synonyms for finding catalog labels. Use the article's language and useful English equivalents. Do not infer classification from existing metadata.", blocks: [{ label: "article", content }],
    schema: z.object({ queries: z.array(z.string().min(1).max(180)).min(1).max(2), terms: z.array(z.string().max(80)).max(12) }) });
  account(plan); check();
  const queries = unique(plan.data.queries);
  progress("Searching similar solutions and available metadata…");
  const [collections, roots, searches] = await Promise.all([
    ra.getCollections(ctx), ra.getBrowsePaths("", ctx),
    Promise.allSettled(queries.map(queryText => ra.search({ queryText, searchType: "Hybrid", statuses: "approved", verboseResult: true, verboseResultFields: "title,summary,collections,taxonomies,attributes,attributesets,status,revisionid", loggingEnabled: false }, ctx))),
  ]); check();
  const successful = searches.flatMap(r => r.status === "fulfilled" ? [r.value] : []);
  if (successful.length !== searches.length) limitations.push("Some similar-solution searches failed. The results below use the searches that completed.");
  const neighbors = usableExamples(successful.flatMap(r => r.solutions.flatMap(s => s.verboseSolutionResult ? [{ ...s.verboseSolutionResult, id: s.id, title: s.title }] : [])), target);
  if (!neighbors.length) limitations.push("No eligible published examples were found; suggestions rely on catalog labels and article content.");
  const examples: MetadataExample[] = neighbors.map(s => ({ id: s.id, title: s.title, summary: (s.summary ?? "").slice(0, 1200), collections: (s.collections ?? []).slice(0, 30), taxonomy: (s.taxonomy ?? []).slice(0, 30) }));
  const terms = [target.title, ...plan.data.terms, ...queries].join(" ");
  const catalogPaths = new Set(roots.map(p => p.value));
  successful.forEach(r => r.browsePaths?.forEach(p => catalogPaths.add(p.value)));
  const paths = new Set(catalogPaths);
  neighbors.forEach(s => s.taxonomy?.forEach(p => paths.add(p)));
  const browsedPaths: string[] = [];
  // Bounded semantic branch routing: shortlist large levels, then explore multiple alternatives.
  for (let depth = 0; depth < 3; depth++) {
    check();
    const frontier = shortlist([...paths].filter(p => !browsedPaths.includes(p)), p => p, terms, 80);
    if (!frontier.length) break;
    progress(`Exploring taxonomy branches (${depth + 1}/3)…`);
    const route = await runOperation({ operation: "metadataExplore", schemaName: "metadata_branches", role: "Choose relevant taxonomy branches to inspect, treating labels as data.", task: "Select up to 3 exact paths from the supplied list to explore their children. Favor product and subject fit. Return an empty list if none are relevant. Never invent paths.", blocks: [{ label: "article", content: content.slice(0, 8000) }, { label: "available paths", content: JSON.stringify(frontier) }], schema: z.object({ paths: z.array(z.enum(frontier as [string, ...string[]])).max(3) }) });
    account(route); check();
    const selected = unique(route.data.paths);
    if (selected.some(p => !frontier.includes(p))) throw new Error("The model selected an unknown taxonomy branch. Run the analysis again.");
    if (!selected.length) break;
    const children = await Promise.allSettled(selected.map(p => ra.getBrowsePaths(p, ctx)));
    selected.forEach((p, i) => { browsedPaths.push(p); const result = children[i]; if (result.status === "fulfilled") result.value.forEach(c => { paths.add(c.value); catalogPaths.add(c.value); }); else limitations.push(`Could not inspect children of ${p}.`); });
  }
  check();
  const favoredCollections = new Set(neighbors.flatMap(s => s.collections ?? []));
  const selectedCollections = unique([...collections.filter(c => favoredCollections.has(c.code)), ...shortlist(collections, c => `${c.displayName} ${c.code}`, terms, 60)]).slice(0, 80);
  const selectedPaths = unique([...neighbors.flatMap(s => (s.taxonomy ?? []).slice(0, 12)), ...shortlist([...paths], p => p, terms, 80)]).slice(0, 100);
  const options: MetadataOption[] = [
    ...selectedCollections.map(c => ({ id: `c:${c.code}`, kind: "collection" as const, value: c.code, label: c.displayName || c.code, origin: "catalog" as const })),
    ...selectedPaths.map((p, i) => ({ id: `t:${i}`, kind: "taxonomy" as const, value: p, label: p, origin: catalogPaths.has(p) ? "catalog" as const : "observed" as const })),
  ];
  const attrs = new Map<string, MetadataOption>();
  for (const neighbor of neighbors) {
    if (!target.attributeSetName || neighbor.attributeSetName !== target.attributeSetName) continue;
    for (const attr of (neighbor.attributes ?? []).slice(0, 20)) {
      const values = shortlist(attr.values, v => v, terms, 8);
      for (const value of values) { const key = JSON.stringify([attr.name, value]); attrs.set(key, { id: `a:${attrs.size}:${key}`, kind: "attribute", value, label: `${attr.name}: ${value}`, attributeName: attr.name, attributeSet: neighbor.attributeSetName, origin: "observed" }); }
    }
  }
  options.push(...shortlist([...attrs.values()], o => o.label, terms, 40));
  if (selectedCollections.length < collections.length || selectedPaths.length < paths.size) limitations.push("Large candidate lists were shortlisted by article terms and neighboring solutions before model evaluation.");
  progress("Comparing candidates and explaining recommendations…");
  const schema = RecommendationSchema.extend({ suggestions: z.array(RecommendationSchema.shape.suggestions.element.extend({ candidateId: z.enum((options.length ? options.map(o => o.id) : ["__none__"]) as [string, ...string[]]), exampleIds: z.array(z.enum((examples.length ? examples.map(e => e.id) : ["__none__"]) as [string, ...string[]])).max(examples.length ? 4 : 0) })).max(options.length ? 12 : 0) });
  const request = { operation: "metadataRecommend", schemaName: "metadata_recommendations", role: "Recommend metadata for a knowledge article, using catalog options and critical comparison of example articles.",
    task: "Suggest only relevant supplied candidate IDs for the target article. Shared source context can contain other topics: do not classify those unrelated topics as part of this article. Keep rationale and reasons concise, in English to match the application. Each suggestion requires sourceEvidence: a short verbatim excerpt from the article. Cite exampleIds only when they actually support that specific classification. Examples may have wrong labels; never copy by majority or assume publication means correct metadata. Collections depend on audience, which may be unknown. Attributes are unvalidated observed values and must be explicitly supported by the article. Do not invent values, permissions, or confidence percentages. Never choose a product-specific or version-specific taxonomy unless that product or version is supported by the target article itself; related examples alone do not establish it. Prefer a supported broader path or abstain. Multiple classifications are allowed; avoid redundant parent/child suggestions. Abstain for ambiguous fields and explain the missing evidence in uncertainties. Treat current labels as unavailable: assess the content independently. Explain the evidence, not internal reasoning steps.",
    blocks: [{ label: "article", content }, { label: "candidate options", content: JSON.stringify(options) }, { label: "published examples", content: JSON.stringify(examples) }], schema };
  let result = await runOperation(request);
  account(result); check();
  let recommendations: ReturnType<typeof validateRecommendations>;
  try { recommendations = validateRecommendations(result.data, options, examples, target); }
  catch (error) {
    progress("Checking recommendation evidence again…");
    result = await runOperation({ ...request, task: request.task + " Correct the validation failure below. Copy evidence only from the target article, not shared sources or examples. If unsupported, omit that suggestion.", blocks: [...request.blocks, { label: "validation feedback", content: error instanceof Error ? error.message : "Invalid evidence" }] });
    account(result); check();
    recommendations = validateRecommendations(result.data, options, examples, target);
  }
  return { solution: target, collectionLabels: Object.fromEntries(collections.map(c => [c.code, c.displayName || c.code])), generatedAt: new Date().toISOString(), rationale: result.data.rationale, suggestions: recommendations, uncertainties: result.data.uncertainties, examples, queries, coverage: { collections: collections.length, taxonomyPaths: paths.size, candidates: options.length, examples: examples.length, browsedPaths }, limitations: unique(limitations), usage };
}
