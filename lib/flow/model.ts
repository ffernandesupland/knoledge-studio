export interface FlowOptions {
  text: boolean; file: boolean; url: boolean; existing: boolean;
  split: boolean; restructure: boolean; standards: boolean; optimize: boolean; dedupe: boolean; gaps: boolean;
  topics: number; existingSplits: boolean; batchOverlap: boolean; survivor: "existing" | "new"; fixedTemplate: boolean;
  matches: "none" | "low" | "high"; decision: "pending" | "separate" | "merge";
  conflict: boolean; resolved: boolean;
  failure: "none" | "rejected" | "uncertain";
}
export type NodeKind = "input" | "ai" | "api" | "logic" | "human" | "write" | "stop";
export interface FlowNode { id: string; title: string; kind: NodeKind; detail: string; active: boolean; prompt?: string; children?: FlowNode[] }
export const DEFAULT_FLOW: FlowOptions = { text: true, file: false, url: false, existing: false, split: true, restructure: true, standards: true, optimize: false, dedupe: true, gaps: false, topics: 2, existingSplits: false, batchOverlap: false, survivor: "existing", fixedTemplate: false, matches: "high", decision: "pending", conflict: false, resolved: false, failure: "none" };

/** A decision tree, not a prediction of an AI result. Inactive branches remain inspectable. */
export function buildFlow(o: FlowOptions): FlowNode[] {
  const content = o.text || o.file || o.url || o.existing;
  const group = content && o.dedupe && (o.matches === "high" || (o.topics > 1 && o.batchOverlap));
  const waiting = group && o.decision === "pending";
  const merge = group && o.decision === "merge";
  const submit = content && !waiting;
  const conflict = submit && merge && o.conflict;
  const ready = submit && (!conflict || o.resolved);
  const splitExisting = o.existing && o.split && o.existingSplits;
  const existingSurvivor = o.survivor === "existing" && (o.existing || o.matches === "high");
  const n = (id: string, title: string, kind: NodeKind, active: boolean, detail: string, children?: FlowNode[], prompt?: string): FlowNode => ({ id, title, kind, active, detail, children, prompt });
  return [
    n("input", "1 · Add source material", "input", true, "Ingestion does not call AI. Limits: 4 MB per uploaded file, 2 MB per fetched page, 500,000 source characters per analysis.", [
      n("text", "Typed or pasted text", "input", o.text, "Keep the original source text and wrap it as untrusted data for model calls."),
      n("file", "Upload PDF, DOCX or text", "api", o.file, "POST /api/ingest → allowlist and size check → parse locally → extracted text persisted with the run."),
      n("url", "Fetch a URL", "api", o.url, "POST /api/ingest → check scheme/address → validate DNS and every redirect → bounded text extraction. No credentials sent to the source."),
      n("kb", "Pick existing solutions", "api", o.existing, "GET /api/kb/search → RA Neural search → user picks IDs → fetch full articles. Preserve IDs, templates and source versions."),
      n("empty", "No source content", "stop", !content, o.gaps ? "Gap discovery may run alone. Suggestions are research tasks, not articles." : "Stop: add source material or enable Find gaps."),
    ]),
    n("analysis", "2 · Analyze → build the Check screen", "logic", content || o.gaps, "POST /api/run. No KB writes. Calls are recorded with model, prompt version, tokens and cost.", [
      n("split", "Split topics enabled", "ai", content && o.split, "One split call for combined new material; a separate call per picked KB article. Preserve prerequisites and warnings in each topic.", [
        n("single", "One topic from an existing article", "logic", o.existing && !splitExisting, "Keep the existing ID as the explicit update target and retain its template."),
        n("many", "Existing article splits into several topics", "logic", splitExisting, "Create new topic drafts with explicit source provenance. Keep the original intact; never guess which fragment replaces it."),
      ], "split"),
      n("no_split", "Split topics disabled", "logic", content && !o.split, "New material becomes one topic; each picked existing article remains separate. No split prompt."),
      n("template", "Choose a template", "ai", content && o.restructure && !o.fixedTemplate && (!o.existing || splitExisting || o.text || o.file || o.url), "For new drafts only, and only if more than one eligible template exists. Existing update targets keep their real template.", undefined, "chooseTemplate"),
      n("template_fixed", "Keep a template without AI", "logic", content && (!o.restructure || o.fixedTemplate || o.existing), "Use the existing, explicitly selected, or deterministic default template. No template prompt when restructuring is off."),
      n("optimize", "Optimize for search", "ai", content && o.optimize, "Fetch company top searches. If history is unavailable/empty, warn and skip. Use searches as untrusted evidence; retain optimized title and keywords.", undefined, "optimizeSearch"),
      n("dedupe", "Find duplicates", "logic", content && o.dedupe, "Retrieval finds candidates; AI judges coverage. RA relevance scores are never used as similarity percentages.", [
        n("query", "Generate focused and keyword queries", "ai", true, "Generate a focused 3–8-term task query and a broad 1–3-term keyword query from the full topic body.", undefined, "dedupeQuery"),
        n("search", "Search Hybrid, Keyword and Neural", "api", true, "Hybrid + two Keyword pages + lower-weight Neural results, no search logging. Fuse result ranks, deduplicate IDs and exclude picked sources; compare up to 16 full articles. Record each query, returned IDs and compared IDs. Search failure stops analysis rather than implying no duplicates."),
        n("no_match", "No neighbours returned", "logic", o.matches === "none", "Skip external adjudication. Zero search results do not skip the within-batch check."),
        n("compare", "Compare full articles in required slots", "ai", o.matches !== "none", "Compare full bodies in batches of four, at most two calls in parallel. Every article has a required schema slot; server code restores the real ID. Invalid output gets one bounded retry. Equivalent wording/format changes can still be duplicates; unrelated primary tasks remain distinct. Scores are judgments, not probabilities.", undefined, "dedupeAdjudicate"),
        n("batch", "Compare drafts within this batch", "ai", o.topics > 1, "Evaluate every draft pair, 12 pairs per call, with required schema slots including distinct verdicts. Only non-distinct pairs proceed to grouping.", undefined, "batchAdjudicate"),
        n("low", "Below 80 → keep as possible matches", "logic", o.matches === "low", "Show individual matches and rationale; no mandatory merge set from these links."),
        n("group", "80 or above → propose a review group", "logic", (o.matches === "high" || (o.topics > 1 && o.batchOverlap)), "Require sameUserNeed=true as well as 80+ similarity. Different reader questions/tasks stay separate despite shared background. Build connected groups from qualifying overlaps. Prefer an existing survivor, then the highest view count. This recommends a choice; it does not authorize any write."),
      ]),
      n("gaps", "Find knowledge gaps", "logic", o.gaps, "Company top 15 queries → search each → read up to 3 articles per query. Retrieval failures are warnings, not evidence of missing coverage.", [
        n("gap_ai", "Judge coverage using article content", "ai", true, "Call only with usable evidence. Suggestions above 0.6 confidence are research tasks, unselected and blocked from submission.", undefined, "findGaps"),
        n("gap_answer", "Author researches a supported answer", "human", true, "Use the suggestion as a starting point, add verified source material and start a new analysis, including duplicates if enabled."),
      ]),
      n("plan", "Synthesize the review plan after evidence gathering", "ai", content || o.gaps, "Runs after the enabled analysis tools, when proposals exist—even if all optional operations are off. Combine full topic source text, selected actions, tool outcomes, warnings and duplicate evidence. Return purpose, outline, why and open questions for every topic. Validate exact topic keys. No article fields or write tools. Gap-only runs without suggestions skip this call.", undefined, "plan"),
    ]),
    n("check", "3 · Review the plan → human decisions", "human", content || o.gaps, "Review purpose, coverage, why, sources and open questions. Select proposals; resolve duplicates. Template-independent planning only; no authored article preview.", [
      n("pending", "Duplicate set unresolved", "stop", waiting, "Wait for the author. The server also blocks submit if a selected group has no resolution."),
      n("separate", "Keep articles separate", "human", group && o.decision === "separate", "Each selected candidate becomes its own create/update. No merge prompt and no merge flags."),
      n("merge", "Merge → choose survivor → confirm sources", "human", merge, "The author chooses the retained article and confirms the group. Unselected own candidates are excluded; external duplicate members remain included."),
      n("deselect", "Deselect a candidate", "human", true, "No write for that candidate. A deselected candidate is also omitted from its merge."),
    ]),
    n("metadata", "4 · Metadata and draft editing", "human", submit, "Set collection, language classification, standards and new-draft templates. Save a coherent decision snapshot; reload restores survivor choices and toggles. Source/title edits persist. No AI call at this stage."),
    n("submit", "5 · Submit → prepare final content", "logic", submit, "Server validates ownership and the stored candidate/group identities. Freeze the write plan and acquire a per-run lock.", [
      n("merge_ai", "Merge selected source content", "ai", merge, "Read current existing sources; combine against the survivor's template. Retain conflicts, contributions and template warnings. Detect source changes before writing.", undefined, "mergeSections"),
      n("author", "Restructure an unmerged article", "ai", !merge && o.restructure, "Original source + reviewed scope plan (guidance, not facts) → final template fields, title, summary and keywords. Preserve user/optimized title choices. Never guess missing technical facts.", undefined, "restructure"),
      n("compose", "New article → populate final template", "ai", !merge && !o.restructure && (o.text || o.file || o.url || splitExisting), "Even with rewriting disabled, map source passages to every relevant final-template field, generate summary and keywords, and convert source formatting to HTML. Preserve source wording. Never invent missing facts.", undefined, "compose"),
      n("raw", "Existing article, rewriting disabled", "logic", !merge && !o.restructure && o.existing && !splitExisting, "Retain original template fields and metadata. Validate HTML and the template contract."),
      n("conflicts", "Conflicting claims found", "human", conflict, "Persist the prepared content and pause this article before writing. Show competing source claims and editable fields.", [
        n("unresolved", "Wait for a resolution", "stop", !o.resolved, "No write for the conflicted article. Other independent articles may finish; merge flags wait for their own survivor."),
        n("resolved", "Author resolves and continues", "human", o.resolved, "Apply version-matched field edits to the saved preparation. Do not regenerate the merge or lose the decision."),
      ]),
      n("standards", "Apply selected content standards", "ai", ready && o.standards, "Runs on BOTH merged and ordinary final fields. Edit wording/formatting only; retain the per-rule results.", undefined, "standards"),
      n("validate", "Validate final article", "logic", ready, "Exact field names/count, required supported content, nonempty answer, title, HTML allowlist and source version. Convert plain Markdown to HTML; reject Markdown syntax embedded in HTML prose. Invalid content pauses for editing; never silently discard unknown fields."),
    ]),
    n("write", "6 · Write to RightAnswers", "write", ready, "Journal intent before a write. Never automatically retry non-idempotent POSTs.", [
      n("create", "New survivor or new topic → create", "write", (merge ? !existingSurvivor : o.text || o.file || o.url || splitExisting), "manageSolution without solutionID; status=review; final title, summary, keywords, fields, collection and language."),
      n("revise", "Existing survivor/update → revision or draft edit", "write", (merge ? existingSurvivor : o.existing && !splitExisting), "Published parent: revisionParentID leaves live content untouched. Existing draft: direct draft edit. An unrelated pending revision blocks the update."),
      n("flags", "Survivor succeeded → flag existing losers", "write", merge && o.failure === "none", "Post internal comments with the actual retained parent/new article ID. Do not archive or move analytics. New losing drafts were never created and need no flag."),
      n("success", "Successful write", "logic", o.failure === "none", "Persist actual payload, final article, write ID and AI usage. Retries return the saved success without writing again."),
      n("rejected", "Definite rejection", "stop", o.failure === "rejected", "Persist a partial run with the error. Retry unfinished work only; completed writes are retained. This group's flags wait."),
      n("unknown", "Timeout / lost response / worker interruption", "stop", o.failure === "uncertain", "Mark outcome uncertain. Do not resend automatically. Author verifies RA; confirm a matching actual article or explicitly verify no write occurred before retry."),
    ]),
    n("analysis_error", "Analysis fails or connection is interrupted", "stop", false, "No KB writes occurred. An incomplete connection is shown as an error. Reload retrieves a run if the server completed it; otherwise repeat analysis with the saved sources."),
    n("regenerate", "Unwritten new article needs different template", "human", false, "On a review item, choose a template and regenerate from saved sources. Version-check the review, prepare fields and metadata, then pause for review. No writes occur during regeneration; completed articles remain saved."),
    n("result", "7 · Results, preview and recovery", "human", submit, "View final formatted content, saved outcomes and total recorded AI cost. Reload resumes partial work; completed operations remain idempotent. Approval and publication happen in RightAnswers, outside Knowledge Studio."),
  ];
}

export function effectiveNodes(nodes: FlowNode[], parent = true): FlowNode[] {
  return nodes.map((n) => ({ ...n, active: parent && n.active, children: n.children ? effectiveNodes(n.children, parent && n.active) : undefined }));
}
export function mermaidTree(nodes: FlowNode[]): string {
  const lines = ["flowchart TD", 'root["Knowledge Studio"]'];
  function visit(items: FlowNode[], parent: string) {
    for (const n of items) {
      lines.push(`${n.id}["${n.title.replace(/["<>]/g, " ")}"]`, `${parent} --> ${n.id}`);
      if (n.prompt) lines.push(`click ${n.id} "#prompt-${n.prompt}" "Inspect ${n.prompt}"`);
      if (!n.active) lines.push(`style ${n.id} fill:#f3f4f6,color:#9ca3af,stroke:#d1d5db`);
      if (n.children) visit(n.children, n.id);
    }
  }
  visit(effectiveNodes(nodes), "root");
  return lines.join("\n");
}
