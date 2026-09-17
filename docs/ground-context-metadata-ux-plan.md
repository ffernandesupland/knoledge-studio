# Ground Context, metadata review, and draft reliability

Date: 2026-09-17
Status: implemented locally, with live service verification and validated attribute writes still outstanding.

## Delivery notes

- Implemented canonical reference content checks, legacy snapshot comparison, named saved/current diagnostics, persisted reference failures, draft retention on failed retries, metadata-only draft reuse, and archived draft downloads.
- Added title/ID reference cards and reference summaries across the workflow.
- Replaced the metadata form stack with article navigation, per-suggestion decisions, clearer final values and inheritance, retry states, current attribute display and attribute triage.
- Metadata research explicitly receives selected references, validates quoted reference evidence and includes reference identity in caching. New-article research can discover attribute candidates across observed attribute sets.
- Added accessible evidence dialogs, separate final-graph reference nodes, exact excerpt-to-claim views, evidence export and saved metadata/attribute decisions in prepared results.
- Added a final-draft warning when accepted metadata evidence differs from the saved research. This is an excerpt/change check, not a semantic guarantee that the classification is correct.
- Attribute candidates can be kept for validation, rejected or deferred. They are not written: the repository does not establish an authoritative attribute catalog or verified write semantics. Do not present observed candidate values as validated assignments.
- No local service credentials were available for verifying the affected production reference or running real AI preparation. Browser validation used intercepted APIs. Production deployment and live acceptance are not implied by local checks.

## Findings verified in the current code

1. The Submit screenshot reports reference 250328091518223 changed. In lib/pipeline/execute.ts, assertGroundReferencesCurrent runs before the article preparation loop. This error prevents draft generation from starting; it is not evidence that the generation model failed.
2. lib/ground-context/server.ts hashes the reference body, raw status and raw lastModifiedDate. A diagnostic using referenceFromSolution confirmed that an equivalent timestamp representation, a timestamp-only update, and reordered fields each change this hash. A repeated identical response does not. The actual old/new payloads for the live run were not inspected, so the specific cause remains unverified.
3. Reference selection chips fall back to IDs when the local search cache and saved references do not supply titles. The screenshot shows this fallback. GroundContextInput must resolve display details independently of the current search and retain them across navigation.
4. PipelineMetadata explicitly filters attribute suggestions out of its display. MetadataValues supports collections, taxonomies and language only. Attributes therefore require a complete review, persistence, validation and submission path, not just another control.
5. Attribute research currently uses values observed on neighboring articles with the same attribute set. New articles have no explicit attribute-set selection path. The client exposes write parameters but no administrative attribute-definition discovery method. Catalog validation support needs investigation before presenting observed values as valid choices.
6. Metadata suggestions already have reasons, exact target-article excerpts and supporting example IDs. The pipeline UI does not connect those elements visually. Examples retain collections and taxonomy, but not attribute evidence.
7. The metadata endpoint supplies original sources but does not explicitly pass run.groundContext. Research currently examines proposed content before reference enrichment; its cache identity also does not include reference versions or guidance.
8. SubmissionGraph and its exported diagram represent processing sources, actions and outputs only. GroundContextReport renders reference excerpts in a prepared-article panel, but the graph has no reference relationships, and blocked preparation leaves users without this evidence view.
9. The submit hook clears visible results on a plan event. A subsequent run-level preparation error can hide previously displayed drafts until restoration. Errors need persistent, per-article states and retained draft visibility.

## Product rules

- Distinguish processing sources, author-selected Ground Context references, and similar articles discovered during metadata research. A similar article is not automatically an authoritative reference or a merge input.
- Always show solution title and ID together. Never imply that every selected reference was used.
- Show a concise decision explanation backed by saved excerpts and catalog matches. Do not invent model reasoning or unsupported causal connections.
- Keep selected, available, actually cited, not used, and blocked states distinct. Before generation, usage is pending rather than zero.
- Preserve user edits and completed work during retries and reference refreshes. Any changed evidence invalidates affected approvals.

## Phase 1 — Diagnose and repair preparation blockers

Priority: first, because all downstream review depends on a generated draft.

1. Add a structured reference comparison: title, ID, saved/current timestamps, content fingerprint, status/access result, and changed field names. Record a safe diagnostic with the run; keep full reference content in authenticated evidence views.
2. Compare the affected run's saved reference with current actor-scoped retrieval. Determine whether it is a real edit, a representation change, or inconsistent upstream responses. Do not disable the version guard to make generation proceed.
3. Separate canonical content fingerprints from freshness metadata. Normalize harmless timestamp/serialization variation; compare fields by stable identity while detecting all material text changes. Preserve meaningful ordering within field content and explicit checks for publication and access.
4. Version the fingerprint algorithm and handle older snapshots explicitly. Compare legacy saved content where safe; otherwise offer a guided refresh rather than silently trusting or discarding it.
5. Replace the generic banner with named references and actionable reasons. Provide View changes, Refresh references and re-analyze, or Back to content. Refresh preserves original input, selections and guidance; affected plans/metadata/drafts require revalidation, while user draft edits remain available for comparison.
6. Preflight before expensive generation. Show per-article stages: Checking references, Generating draft, Applying reference information, Checking evidence, Ready for review, or Needs attention.
7. Persist failures and partial results. Keep existing drafts visible on a failed retry; stop presenting an outline as if it were a generated article. Retry failed work without repeating completed KB writes.

Acceptance: unchanged references permit preparation; real content/status/access changes produce a named, recoverable block; reload preserves progress; preparation makes no KB writes; submission requires the exact reviewed draft version.

## Phase 2 — Explain which solutions provide context

Replace ID-only chips with compact reference cards: title, ID, publication status, snapshot date and Preview/Remove actions. Resolve titles for restored selections and display Loading title or Unavailable explicitly.

Suggested copy:

> AI will consult these 3 reference solutions when planning and enriching your articles. Relevant information may be used; each generated draft will show the exact supporting excerpts. These solutions will remain unchanged.

Show a persistent reference summary on Review plan, Metadata and Final review, including author guidance. In proposal details, replace vague references to “reference material” with named sources and recorded support where available. Keep proposed support separate from verified final usage.

Acceptance: users can name every selected reference without another search; the same selection is visible throughout the workflow; disabled references clearly show that they will not be sent.

## Phase 3 — Redesign metadata as a review task

Use the existing step with an article list, a main review panel and an expandable evidence panel. Reduce the current stack of expanded forms.

- Header: articles reviewed/remaining, suggestions awaiting decisions, unresolved attributes, research progress and errors.
- Article cards: title, New/Revision/Merge, and Not researched/Researching/Needs review/Reviewed/Error.
- Groups: Destination (collections), Classification (taxonomy), Attributes, and Language. Keep Template and Content standards in a separate article-setup section.
- Each suggestion: current value, suggested value, short reason, exact supporting excerpt, source title/ID, validation state, and Accept/Reject/Choose another actions.
- Decisions: pending, accepted, rejected, edited or deferred, persisted per article and suggestion. Distinguish retained existing values, global defaults and explicit overrides at field level.
- Global changes: show affected article count and preview before applying. Do not silently replace existing per-article decisions.
- Review completion: resolve required choices and explicitly defer optional ones. Research completion does not mean the user accepted suggestions.
- Loading, cancellation, empty results and failures: keep completed work, offer per-article retry and manual selection. An error must not look like successful research with no suggestions.

Evidence timing: initial metadata recommendations are provisional because the draft has not yet been enriched. Pass Ground Context explicitly and include its identity in research caching. Do not infer target product/version/jurisdiction merely because a reference discusses it. After preparation or article edits, validate accepted classifications against the final draft and flag affected decisions for review without silently changing them.

Acceptance: a user can tell what will be submitted, why each value was suggested, what is inherited, and what remains undecided.

## Phase 4 — Attribute triage end to end

1. Identify the applicable attribute set from the existing article or explicit selection for a new article. Preserve existing values by default.
2. Verify available RightAnswers definition/read/write capabilities: allowed values, cardinality, required fields, and update/clear semantics. Reuse the current client only where its contract is established.
3. Show attributes grouped by set/name with current and suggested values, exact supporting text, and validation badges. Observed on similar solutions is distinct from Valid catalog value.
4. Support accept/reject/edit/defer and explicit disposition for unavailable or unsupported values. Unsupported values remain visible for triage but cannot masquerade as ready-to-submit assignments.
5. Extend metadata types and schemas, saved decisions, effective value resolution, plan identities, validation, prepared previews, create/revise payloads and autonomous decisions together.
6. Store attribute examples with the exact supporting set/name/value. Restrict global attribute application to compatible sets.

Acceptance: accepted validated attributes survive reload, preparation and submission; invalid sets/values are blocked; rejected/deferred values are not written; revisions preserve unrelated attributes.

## Phase 5 — Openable evidence diagrams

Add a Why this suggestion? button to each metadata suggestion and View evidence map to the article header. Open an accessible dialog with a diagram and equivalent list view.

Diagram relationships:

- Processing source excerpt -> resulting article excerpt -> suggested metadata value.
- Ground Context excerpt -> supported draft claim -> suggested metadata value, only where that connection is recorded and validated.
- Similar solution -> observed classification example -> suggestion, labeled comparison evidence.
- Catalog definition -> allowed value; user decision -> final metadata assignment.

Every node includes a human-readable label; selecting a connection reveals its exact supporting excerpt and concise rationale. Do not draw unsupported links from aggregate source text: extend structured provenance to retain document IDs, field IDs, quote locations and versions. Persist maps with the article/metadata versions and invalidate them after edits. Support keyboard navigation, text alternatives, zoom and export.

Acceptance: every displayed connection resolves to saved evidence; missing evidence is disclosed; the diagram shows supporting evidence and recorded decisions rather than speculative internal reasoning.

## Phase 6 — Ground Context in final review and history

Add a visually distinct Reference solutions lane to the submission graph. Processing inputs feed Create/Revise/Merge; reference edges feed supported claims without implying that references will be modified.

- Before preparation: display selected references with Usage pending, even if preparation is blocked.
- After preparation: show references used/selected, supported-claim count and unresolved issues per article.
- Clicking a reference or edge: title/ID/version, exact reference excerpt, exact final article passage, destination field, and supported use such as prerequisite, instruction or correction.
- Show considered-but-unused references separately. A missing citation alone does not establish why a reference was unused; add an explicit, reviewable applicability result if a reason is presented.
- Include accepted metadata and attribute provenance, user changes and outstanding decisions in the overall review summary.
- Preserve these relationships in saved execution history and diagram export, not just the current screen. Share the data model across guided and autonomous runs.

Acceptance: for every output users can answer which references were used, what text they contributed, where it appears, and which references were not used.

## Verification and delivery

During this review, 71 targeted test cases passed across grounding, metadata and pipeline execution. The pipeline test suite exited with a Windows EPERM error in temporary-database cleanup after its test cases passed. These tests use mocked services and do not validate the affected live RightAnswers reference or real model output.

Implementation checks:

1. Regression tests for timestamp representation, field order, actual content changes, access revocation, legacy snapshots, guided refresh, and retry persistence.
2. Grounded draft flows: create, revise, merge, restructure disabled, conflicting references, edit/revalidate, regenerate, resume, partial failure and autonomous execution.
3. Metadata/attributes: per-suggestion decisions, inheritance, source identity, catalog validation, payload preservation and stale evidence after draft edits.
4. Browser checks: selection titles across steps/reload, research status, triage, evidence dialogs, final graph, keyboard/mobile access and reference-refresh recovery.
5. A controlled live preparation run to verify real reference retrieval and model output before any KB submission. Record whether preparation completes and inspect actual excerpts, fields and issues.
6. TypeScript, lint and production build; report test infrastructure failures separately from feature failures.

Delivery order: preparation reliability -> reference messaging/provenance contract -> metadata review and attributes -> evidence diagrams and final graph -> integrated verification. Keep the preparation fix independently reviewable; do not wait for the full UI redesign to restore reliable draft generation.
