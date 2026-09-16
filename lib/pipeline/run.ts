import { resolveGroundContext } from "../ground-context/server";
import type { GroundContextInput, GroundContextSnapshot } from "../ground-context/types";
import { orderedSources } from "../ks/source-document";
import { withSourceContext } from "../llm/source-context";
import type { SourceAttachment, SourceBlock } from "@/lib/ks/source-document";
import { planContent, type ContentProposal } from "../llm/planning";
import { solutionVersion } from "./version";
import { ra } from "../ra/client";
import { bodyField, draftFields } from "./content";
import type { WSTemplate } from "../ra/types";
import { chooseTemplate, findGaps, optimizeForSearch, splitTopics } from "../llm/operations";
import {
  SolutionCache,
  findDuplicatesFor,
  findIntraBatchOverlaps,
  type Candidate,
  type DuplicateMatch,
} from "./dedupe";
import { buildDuplicateGroups, type DuplicateGroup } from "./grouping";

export type OperationName =
  | "Discover and suggest metadata"
  | "Split topics"
  | "Restructure content"
  | "Apply content standards"
  | "Find duplicates"
  | "Optimize for search"
  | "Find gaps";

export interface RunInput {
  groundContext?: GroundContextInput;
  text: string;
  /** Text extracted from uploaded files and fetched URLs. */
  attachments?: SourceAttachment[];
  content?: SourceBlock[];
  /** Existing solutions pulled in from the KB picker. */
  sourceSolutionIds?: string[];
  operations: OperationName[];
  /** Fixed template for every topic. Omit to let the pipeline pick one per topic. */
  templateName?: string;
  collection?: string;
  language?: string;
}

export interface PlannedSolution {
  key: string;
  proposal?: ContentProposal;
  sourceLabels?: string[];
  targetSolutionId?: string;
  sourceVersion?: string;
  edited?: boolean;
  sourceIds?: string[];
  titleLocked?: boolean;
  researchOnly?: boolean;
  title: string;
  summary: string;
  keywords: string[];
  templateName: string;
  fields: { fieldName: string; fieldValue: string }[];
  /**
   * The original, pre-authoring text this solution came from. The real, template-aware,
   * well-formatted content is authored from this at submit time — after Metadata decisions
   * (including any per-solution template override) are final — not here. See ARCHITECTURE.md §7.
   */
  rawContent: string;
  /** Where the content came from, shown in the Check screen's "Why" column. */
  source: "Your content" | "Knowledge base" | "Find gaps";
  sourceSolutionId?: string;
  rationale: string;
  duplicates: DuplicateMatch[];
}

export interface RunOutput {
  groundContext?: GroundContextSnapshot;
  solutions: PlannedSolution[];
  groups: DuplicateGroup[];
  costUsd: number;
  warnings?: string[];
  steps: { name: string; ms: number; costUsd: number; model?: string; details?: unknown }[];
}

export interface ProgressEvent {
  step: string;
  status: "start" | "done";
  detail?: string;
}

type OnProgress = (e: ProgressEvent) => void;

async function step<T>(
  name: string,
  onProgress: OnProgress | undefined,
  steps: RunOutput["steps"],
  fn: () => Promise<{ value: T; costUsd: number; model?: string; details?: unknown }>,
): Promise<T> {
  onProgress?.({ step: name, status: "start" });
  const t0 = Date.now();
  const { value, costUsd, model, details } = await fn();
  steps.push({ name, ms: Date.now() - t0, costUsd, model, ...(details ? { details } : {}) });
  onProgress?.({ step: name, status: "done" });
  return value;
}

/**
 * Executes the Content → Check plan. Nothing here writes to the knowledge base; the output is
 * the proposal the Check screen renders.
 */
export async function runPipeline(input: RunInput, onProgress?: OnProgress, savedGroundContext?: GroundContextSnapshot): Promise<RunOutput> {
  const groundContext = savedGroundContext ?? await resolveGroundContext(input.groundContext, input.sourceSolutionIds);
  if (groundContext?.selection.enabled && !input.text.trim() && !input.sourceSolutionIds?.length && !orderedSources(input).length) throw new Error("Add a task or source content alongside Ground Context references.");
  return withSourceContext(input.content || input.attachments?.some(a => a.imageId) ? orderedSources(input) : [], () => runPipelineImpl(input, onProgress, groundContext));
}
async function runPipelineImpl(input: RunInput, onProgress?: OnProgress, groundContext?: GroundContextSnapshot): Promise<RunOutput> {
  const steps: RunOutput["steps"] = [];
  const warnings: string[] = [];
  const has = (op: OperationName) => input.operations.includes(op);

  const templates = await step("Loading article templates", onProgress, steps, async () => ({ value: await ra.getTemplates(), costUsd: 0 }));
  const forced: WSTemplate | undefined = input.templateName
    ? templates.find((t) => t.templateName === input.templateName)
    : undefined;
  if (input.templateName && !forced) throw new Error("Selected template no longer exists");
  if (!templates.length) throw new Error("No templates available for this company");

  // Standard RA templates only; the QA tenant carries 70+ custom test templates.
  const selectable = templates.filter((t) => t.templateType === "standard" && t.fields.length > 1);

  /* Source material: pasted text plus any KB solutions the author picked. */
  const cache = new SolutionCache();
  const sourceSolutions = input.sourceSolutionIds?.length
    ? await step("Reading selected knowledge articles", onProgress, steps, async () => ({ value: await Promise.all(input.sourceSolutionIds!.map((id) => cache.get(id))), costUsd: 0 }))
    : [];

  // Preserve KB boundaries deterministically. New material may be split together; KB
  // articles are processed separately so model output order never determines a write target.
  const fresh = orderedSources(input);
  const batches = [
    ...(fresh.length ? [{ blocks: fresh, source: undefined as typeof sourceSolutions[number] | undefined }] : []),
    ...sourceSolutions.map((source) => ({ source, blocks: [{ label: `solution ${source.id}`, content: [source.title, source.summary, ...(source.fields ?? []).map((f) => `## ${f.name}\n${f.content}`)].filter(Boolean).join("\n\n") }] })),
  ];
  if (!batches.length && !has("Find gaps")) throw new Error("Nothing to process: add content or enable Find gaps");
  const planned: PlannedSolution[] = [];
  for (const batch of batches) {
    const topics = has("Split topics")
      ? await step(`Split topics: ${batch.source?.title ?? "new content"}`, onProgress, steps, async () => {
          const r = await splitTopics(batch.blocks);
          return { value: r.data.topics, costUsd: r.costUsd, model: r.model };
        })
      : [{ title: batch.source?.title ?? batch.blocks[0].content.replace(/<[^>]*>/g, " ").trim().split("\n")[0].slice(0, 100), content: batch.blocks.map((b) => b.content).join("\n\n"), rationale: "Processed as one topic per source." }];
    if (!topics.length || planned.length + topics.length > 40) throw new Error("Analysis must produce 1–40 topics. Use a smaller batch.");
    const targetId = batch.source && topics.length === 1 ? batch.source.id : undefined;
    for (const topic of topics) {
      const originalTemplate = targetId ? templates.find((t) => t.templateName === batch.source?.templateName) : undefined;
      if (targetId && !originalTemplate) throw new Error(`Source template unavailable for ${targetId}`);
      let template = originalTemplate ?? forced ?? selectable.find((t) => /^How To/i.test(t.templateName)) ?? selectable[0] ?? templates[0];
      if (!targetId && !forced && has("Restructure content") && selectable.length > 1) {
        const choice = await step(`Template: ${topic.title}`, onProgress, steps, async () => {
          const r = await chooseTemplate(topic, selectable);
          return { value: r.data, costUsd: r.costUsd, model: r.model };
        });
        const chosen = selectable.find((t) => t.templateName === choice.templateName);
        if (!chosen) throw new Error("AI selected a template outside the available templates");
        template = chosen;
      }
      // Keep the original HTML as the non-authoring path, even if the author later disables restructuring.
      const originalHtml = targetId ? await ra.getSolutionHtml(targetId) : undefined;
      const fields = originalHtml
        ? template.fields.map((f) => ({ fieldName: f.fieldName, fieldValue: originalHtml.fields?.find((v) => v.name === f.fieldName)?.content ?? "" }))
        : bodyField(template) ? draftFields(topic.content, template) : template.fields.map((f) => ({ fieldName: f.fieldName, fieldValue: "" }));
      planned.push({
        key: targetId ?? `c${planned.length}`, targetSolutionId: targetId,
        sourceSolutionId: targetId, sourceVersion: targetId ? solutionVersion(batch.source!) : undefined, sourceIds: batch.source ? [batch.source.id] : [],
        title: topic.title || "New article", summary: batch.source?.summary ?? "",
        keywords: batch.source?.keywords?.split(",").map((v) => v.trim()).filter(Boolean) ?? [],
        templateName: template.templateName, fields, rawContent: topic.content,
        source: batch.source ? "Knowledge base" : "Your content",
        rationale: batch.source && topics.length > 1 ? `${topic.rationale} Split from ${batch.source.id}; original is kept unchanged.` : topic.rationale,
        sourceLabels: batch.blocks.map((b) => b.label),
        duplicates: [],
      });
    }
  }

  /* 3. Optimize for search ----------------------------------------------- */
  if (has("Optimize for search")) {
    const queries = await ra
      .getCompanyTopSearches()
      .then((t) => t.map((x) => x.description))
      .catch(() => { warnings.push("Search history unavailable; search optimization skipped."); return [] as string[]; });
    for (const sol of queries.length ? planned : []) {
      const r = await step(`Optimize: ${sol.title}`, onProgress, steps, async () => {
        const res = await optimizeForSearch(
          { title: sol.title, keywords: sol.keywords, body: sol.fields.map((f) => f.fieldValue).join("\n\n") },
          queries,
        );
        return { value: res.data, costUsd: res.costUsd, model: res.model };
      });
      if (r.changed) {
        sol.title = r.title;
        sol.titleLocked = true;
        sol.keywords = r.keywords;
      }
    }
  }

  /* 5. Duplicates -------------------------------------------------------- */
  let groups: DuplicateGroup[] = [];
  if (has("Find duplicates")) {
    const candidates: Candidate[] = planned.map((p) => ({
      key: p.key,
      title: p.title,
      body: p.rawContent,
    }));

    const matchesByCandidate: Record<string, DuplicateMatch[]> = {};
    const exclude = new Set([...sourceSolutions.map((s) => s.id), ...(groundContext?.selection.enabled ? groundContext.references.map(r => r.id) : [])]);

    for (const c of candidates) {
      const matches = await step(`Duplicates: ${c.title}`, onProgress, steps, async () => {
        const m = await findDuplicatesFor(c, { cache, exclude, collection: input.collection, language: input.language });
        return { value: m.matches, costUsd: m.costUsd, model: m.model, details: m.retrieval };
      });
      matchesByCandidate[c.key] = matches;
      const sol = planned.find((p) => p.key === c.key);
      if (sol) sol.duplicates = matches;
    }

    const intraBatchPairs = await step("Duplicates: within batch", onProgress, steps, async () => {
      const r = await findIntraBatchOverlaps(candidates);
      return { value: r.pairs, costUsd: r.costUsd, model: r.model };
    });

    groups = buildDuplicateGroups({
      candidates: candidates.map((c) => ({ key: c.key, title: c.title, isNew: !planned.find((p) => p.key === c.key)?.targetSolutionId, viewCount: sourceSolutions.find((s) => s.id === c.key)?.viewCount ?? 0 })),
      matchesByCandidate,
      intraBatchPairs,
    });
  }

  /* 6. Gaps -------------------------------------------------------------- */
  if (has("Find gaps")) {
    const gaps = await step("Find gaps", onProgress, steps, async () => {
      const top = await ra.getCompanyTopSearches().then((t) => t.slice(0, 15).map((x) => x.description))
        .catch(() => { warnings.push("Gap analysis skipped: search history unavailable."); return [] as string[]; });
      const probed: { query: string; topResultTitles: string[]; articles: string[] }[] = [];
      for (const query of top) {
        try {
          const r = await ra.search({ queryText: query, searchType: "Neural", page: 1, collections: input.collection, language: input.language });
          const articles = await Promise.all(r.solutions.slice(0, 3).map((s) => cache.get(s.id)));
          probed.push({ query, topResultTitles: articles.map((s) => s.title), articles: articles.map((s) => [s.title, s.summary, ...(s.fields ?? []).map((f) => f.content)].filter(Boolean).join("\n\n")) });
        } catch { warnings.push(`Gap evidence unavailable for “${query}”; omitted, not treated as zero results.`); }
      }
      if (!probed.length) return { value: [], costUsd: 0 };
      const res = await findGaps(probed);
      return { value: res.data.gaps, costUsd: res.costUsd, model: res.model };
    });

    gaps
      .filter((g) => g.confidence >= 0.6)
      .forEach((g, i) => {
        planned.push({
          key: `g${i}`,
          researchOnly: true,
          title: g.suggestedTitle,
          summary: g.question,
          keywords: [],
          templateName: forced?.templateName ?? selectable[0]?.templateName ?? "",
          fields: [],
          rawContent: "",
          source: "Find gaps",
          rationale: g.rationale,
          duplicates: [],
        });
      });
  }

  if (planned.length) {
    const proposals = await step("Build review plan", onProgress, steps, async () => {
      const r = await planContent(planned.map((p) => {
        const group = groups.find((g) => g.members.some((m) => m.id === p.key));
        return {
          key: p.key, title: p.title, content: p.rawContent || p.summary,
          sourceLabels: p.sourceLabels ?? [p.source],
          proposedAction: p.researchOnly ? "research" : group ? "review merge" : p.targetSolutionId ? "update" : "create",
          reason: p.rationale,
          duplicateEvidence: { checked: has("Find duplicates") && !p.researchOnly, matches: p.duplicates, group },
        };
      }), input.operations, steps.map((s) => s.name), warnings, groundContext);
      return { value: r.data.proposals, costUsd: r.costUsd, model: r.model };
    });
    if (proposals.length !== planned.length || new Set(proposals.map((p) => p.key)).size !== planned.length || proposals.some((p) => !planned.some((s) => s.key === p.key))) {
      throw new Error("Planning response does not match the analyzed topics. Please analyze again.");
    }
    for (const { key, ...proposal } of proposals) planned.find((s) => s.key === key)!.proposal = proposal;
  }

  return {
    warnings,
    groundContext,
    solutions: planned,
    groups,
    costUsd: steps.reduce((s, x) => s + x.costUsd, 0),
    steps,
  };
}
