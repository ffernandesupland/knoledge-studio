# Knowledge Studio implementation review — 2026-09-09

The main weaknesses are at the boundaries between analysis, the wizard's decisions, and submission. The prompts cover the intended operations, but some important outputs and decisions never reach the write correctly. These are functional issues even within the documented pilot scope.

Compared against `../rap-design-prototype/index.html`, `../docs/ARCHITECTURE.md` (especially the as-built sections), and `../docs/PLAN.md`. The current working tree, including uncommitted implementation files, was reviewed.

Validation: `npm run check` passed TypeScript and all 99 tests in 8 files. `npm run lint` failed with 4 errors. Additional local reproductions used stubbed RA/LLM/audit dependencies and made no external calls or writes. No browser automation, live model evaluation, production build, or live RA integration test was performed. Model availability and prices were not independently verified. Application code was not changed.

## Design changes that are intentional

| Area | Assessment |
| --- | --- |
| Standalone Content → Check → Metadata → Submit wizard | Matches the scoped product; the prototype's surrounding application shell is intentionally excluded. |
| SQLite, streamed NDJSON, in-process execution | Documented pilot substitutions for Postgres, SSE, and workers. Not regressions merely because the original diagram differs. |
| Live RA template names and fields | Correct replacement for fictional prototype templates. |
| Flag merge losers instead of archiving | Documented and appropriate to the verified API capabilities. |
| Survivor picker → Sankey confirmation | Deliberate replacement for the interactive field merge workspace (KS-149). However, conflict handling was not actually preserved downstream; see finding 2. |
| Authoring against the final template at submit | Deliberate KS-154 change. It explains why pre-submit previews are raw, but several data-flow problems remain. |
| Owner and review date locked | Documented API/pilot limitations. The owner caption nevertheless says “signed-in account” although the author is hardcoded. |
| Focus editor | Still a simulated surface with no saved edits. The prototype itself deferred the real editor; treat this as unfinished functionality, not an accidental port regression. |

## Prioritized findings

P1 = fix before relying on this workflow for real authoring. P2 = functional correction needed, with a narrower impact.

### 1. P1 — “Improve existing” loses the existing article's identity

`lib/pipeline/run.ts:136–151` assigns every topic a `cN` key, even when `sourceSolutionId` exists. `lib/ks/model.ts:82–101` displays “Update” but drops that source ID. `lib/pipeline/submit.ts:185` decides create versus revise solely from whether the key is a 15-digit RA ID.

Local reproduction through `runPipeline → mapRunToView → buildWritePlan`, with one existing source and operations disabled:

```text
sourceId:     260717092646280
candidateKey: c0
displayAction: Update
writeKind:    create
```

Thus improving an existing solution can create a duplicate instead of revising it. The same identity loss means the UI treats it as eligible for a new-solution template override, and duplicate grouping treats it as new with no history.

There is also a separate provenance error: `sourceSolutions[i]` is associated with split topic `i`. Splitting, combining sources, or mixing pasted material with picked articles does not preserve this positional relationship. Simply changing `cN` to the inferred source ID would risk assigning the wrong article or colliding when one source produces several topics.

Fix: carry explicit source provenance separately from candidate identity and make the intended write target explicit. Define the revision/new-article policy for one source split into multiple topics. Preserve existing templates unless a supported migration is intended.

### 2. P1 — Merge conflicts are detected, then discarded

`lib/llm/operations.ts:166–178` asks the model to surface conflicting claims. But `lib/pipeline/merge.ts:86–92` keeps only each section's `combined` text. Contributions, conflict flags/options, and no-match notes are discarded. The executor writes the result without a conflict check.

A stubbed model response with `conflict.present=true` returned normal writable fields, with no conflict indication in the merge result. This contradicts the as-built architecture's claim that conflict surfacing was preserved when merging moved to submit.

The prompt also asks for a “single reconciled version covering both” incompatible claims. That encourages unsupported reconciliation when evidence cannot establish a correct answer.

Fix: retain conflict information, stop the affected merge before writing, and provide a review/resolution path. Moving authoring to submit is compatible with this; silently dropping its warnings is not.

### 3. P1 — Reload can preserve “merged” while changing which article survives

`components/ks/KnowledgeStudio.tsx:132–180` restores selections and resolutions, but not `survivorChoice`. The saved group still contains the original recommendation. If an author changes the survivor, confirms the merge, and reloads, the resolution stays “merged” while the survivor reverts.

The same resume path does not restore stored operation toggles, collection, or language. Template overrides and standards choices are not persisted. Consequently a refresh can change the destination, turn AI authoring back on after it was disabled, or apply different standards without a new decision. An empty saved selection is also treated as uninitialized by the default-selection effect.

Fix: save and restore one coherent decision snapshot, including the effective groups/survivor, operation flags, metadata, overrides, and standards. Do not infer “not initialized” from an intentionally empty selection.

### 4. P1 — Write retries are not reliably idempotent

`lib/ra/http.ts:47–98` retries POST requests after network faults and server errors. A create/revision may have committed before the response was lost; retrying can create another record. The audit-based skip check cannot protect retries occurring inside that first HTTP call.

Additionally, `lib/pipeline/execute.ts:69` checks success before an awaited remote write, with no atomic claim. Two concurrent submissions can both pass. The audit's unique index rejects the second success record only after both external writes, and `recordAudit` suppresses that error.

Fix: serialize/claim execution per run or operation, distinguish unknown write outcomes from definite failures, and reconcile uncertain creates before resending. Avoid automatic non-idempotent POST retries without an external idempotency/reconciliation mechanism.

### 5. P2 — Selected content standards do not apply to merges

In `lib/pipeline/execute.ts:109–134`, `applyStandards` is inside the non-merge `else`. Any operation with merge sources skips the selected standards entirely.

Local reproduction: submitting a merged candidate with `standardsRules: ['Numbered steps']` resulted in **zero standards calls**. Default HTML instructions in the merge prompt do not implement the author's selected rules.

Fix: apply standards to the final authored fields for both merged and unmerged content, and retain rule results if the UI promises to explain compliance. Update the Metadata caption at `KnowledgeStudio.tsx:1009`: it currently says standards run during analysis and require a rerun, although they now run on submit.

### 6. P2 — Restructuring assumes the first field is the answer field

`lib/llm/operations.ts:86–101` selects `template.fields[0]` and explicitly instructs the model to put the substantive answer there. The documented tenant's Problem template starts with **Cause**, and Error starts with **Error Message**. A valid procedure can therefore be directed into the wrong semantic field.

The raw draft placeholder in `lib/pipeline/run.ts:165–168` makes the same assumption. If restructuring is disabled, that placeholder can become the write itself.

Fix: identify the body/answer field from template semantics or explicit configuration. Do not treat field order as a semantic guarantee.

### 7. P2 — AI-generated titles, summaries, and keywords are lost

`restructure` returns all four content components, but `lib/pipeline/execute.ts:126–127` uses only `fields`. With splitting and optimization disabled, pasted content is titled “Untitled” during planning; it remains “Untitled” at creation even when the authoring model returns a meaningful title. This was reproduced locally.

Optimization writes keywords to `PlannedSolution`, but `mapRunToView` drops them; the write plan and executor do not forward them. Summaries are also dropped. The advertised title-and-keyword search optimization only persists the title portion when `changed=true`.

Fix: retain final title/summary/keywords through the view and write models, with explicit precedence for user-edited titles and search optimization. Pass original keywords into optimization if the prompt promises to preserve them when unchanged.

### 8. P2 — Gap suggestions can be submitted as empty articles

`lib/pipeline/run.ts:249–260` appends gap candidates with `fields: []` and `rawContent: ''`. All candidates start selected. `execute.ts:122` skips restructuring on empty raw content, and the planner permits creation. The result is an attempted empty review article, not knowledge that answers the gap.

Gap evidence also overstates certainty: search failures become empty result lists (`run.ts:235–238`), indistinguishable from successful searches with no hits. The prompt decides whether an article answers a query using only titles, not article content. No duplicate pass is applied to the appended gap candidates.

Fix: represent gaps as research/authoring tasks until supported answer material exists; block empty article submission. Keep retrieval errors distinct from absent coverage and inspect supporting content before treating a gap as established.

### 9. P2 — Partial failure has no usable recovery path

`app/api/submit/route.ts:74` marks a run submitted even if operation results contain errors. `lib/db/runs.ts:198` resumes only `done` runs, excluding that partial submission. The UI requires `submitRun.phase === 'idle'` to submit (`KnowledgeStudio.tsx:1610–1611`), so an `error` phase cannot retry and a completed partial result has no retry control.

Both streaming hooks also read the body outside an error handler. A thrown read or EOF without a terminal result can leave the wizard in “running”/“submitting”.

Fix: persist per-operation completion and a partial/failed run state, expose retry of unfinished operations, and explicitly handle interrupted/malformed streams. Flags should depend on their own survivor write; today a failure in any unrelated content write suppresses all subsequent flags.

### 10. P2 — Merge comments receive the losing ID as the survivor ID

`lib/pipeline/execute.ts:167–170` calls `flagMergedInto(op.solutionId, { id: op.solutionId, title: op.survivorLabel })`. Both IDs are the loser. The text label may contain the actual existing survivor ID, leaving contradictory IDs in the comment; for a new survivor it contains a temporary `cN` key instead of the created RA ID.

Local stub reproduction confirmed the wrong structured ID. Fix: carry the survivor dependency explicitly and resolve its actual ID from the successful content write before posting comments.

### 11. P2 — Submit-time AI is missing from the durable audit and cost accounting

`lib/pipeline/execute.ts:182` records `request: op`, whose fields are the pre-authoring draft, rather than the actual final request. Local reproduction recorded “raw text” while the outgoing fields contained “Authored answer”. Final fields are returned to the browser but not stored with submission results in the run.

Analysis cost is persisted, but submit-time restructure/standards costs and the returned merge cost are ignored. Rule reports and merge warnings are also dropped. It is not possible to reconstruct the complete transformation or total recorded model cost from the run.

Fix: persist the actual final payload, write target, output/results, operation model and token usage, and accumulated submit cost. Version prompts/rules so later reviews can explain which instructions generated a draft.

### 12. P2 — Search-query text bypasses the untrusted-content boundary

`lib/llm/operations.ts:239–240` interpolates logged user searches into the trusted operator task. These strings are user-authored content, not operator instructions. This bypasses the isolation used for article bodies and can influence generated titles/keywords with instructions embedded in search text.

Fix: put search queries in untrusted data blocks with constant labels. Audit labels too: titles, filenames, and gap-query strings are interpolated into labels, while delimiter neutralization only processes block bodies. Delimiters and a system rule reduce risk; they are not proof that a model will resist all injected instructions. No live adversarial-model test was performed.

## When AI actually runs

Configured model names below come directly from `lib/llm/models.ts`; they are not an assertion of current public API availability.

| Trigger | Operation and configured model | Input → consumed result |
| --- | --- | --- |
| Analyze, “Split topics” on | `splitTopics`, terra | Pasted text, parsed attachments, picked articles → topic title/content/rationale. |
| Analyze, no forced template and >1 eligible standard template | `chooseTemplate`, luna, once per topic | Topic plus template names/field names → selected template. Runs even with every visible operation off. |
| Analyze, “Optimize for search” on | `optimizeForSearch`, luna, once per planned topic | Title/body and up to 40 logged searches → title and keywords; only title survives downstream. |
| Analyze, “Find duplicates” on | `generateSearchQuery`, luna, once per topic | Topic title/body → one retrieval query. RA search itself is not a model call. |
| Dedupe retrieval has readable neighbours | Adjudication, luna, once per topic | Candidate plus up to 8 fetched articles → duplicate/overlap verdicts, scores, reasons. |
| Analyze, dedupe on and at least 2 candidates | Intra-batch adjudication, luna | All candidates → overlapping pairs. Grouping and survivor recommendation are deterministic. |
| Analyze, “Find gaps” on | `findGaps`, luna | Up to 15 top queries and top 3 result titles each → suggestions above 0.6 confidence. Runs even when the usable query list is empty. |
| Submit, non-merge, restructure on, raw content present, target template found | `restructure`, terra | Original topic plus final template → fields; generated title/summary/keywords discarded. |
| Submit, non-merge, standards list nonempty | `applyStandards`, luna | Final/draft fields plus rules → edited fields; rule report discarded. |
| Submit, merge sources nonempty | `mergeSections`, terra | Survivor and other source fields plus final target template → combined fields. Independent of restructure toggle; standards bypassed. |

Ingestion, selection, survivor confirmation, template overrides, focus editing, and previews make no model calls. Changing metadata does not re-author a preview. Submit previews after completion show returned fields as escaped text in a `<pre>`, so HTML formatting is not rendered as the final article will appear.

For N topics, ordinary analysis can require a split call, N template calls, N optimization calls, N dedupe-query calls, up to N adjudication calls, one batch comparison, and one gap call. Authoring adds calls at submission. The pipeline is largely sequential; its actual call count depends on toggles, available templates, and retrieval results.

## Prompt and engine assessment

Useful foundations: a shared structured-output client, explicit no-invention instructions, live template schemas, duplicate adjudication over full article bodies rather than raw RA relevance scores, per-run article caching, server-side credentials, and a published-status revision guard. These are good choices to preserve.

Remaining output validation is mostly structural. Restructure/standards schemas accept arbitrary field-name strings and empty or incomplete field arrays. Merge filters unknown fields but does not require every expected field or nonempty required fields. Add semantic validation against the final template before writing, with a controlled repair/failure path. JSON schema alone does not establish completeness or factual fidelity.

Prompt improvements should follow the data-flow fixes: preserve explicit source IDs through split, distinguish factual conflicts from compatible additional detail, give batch adjudication the same scoring/verdict rubric as external dedupe, and scope gap/optimization evidence to relevant collection/language where possible. The prompts currently do not direct translation into the selected output language; confirm whether language is intended only as metadata.

Evaluate real model behavior with fixed cases: a multi-topic procedure with shared prerequisites; two contradictory versions; a mixed-template merge; an already-correct article; missing required information; an injected search query; and a genuine versus false gap. The current tests verify wrappers and helper behavior, not these semantic outcomes.

## Test and pilot limits

The existing submit tests construct existing candidates with numeric keys directly. That is why they pass while the actual pipeline-to-view-to-planner identity path fails. There are no checked-in orchestration tests for `runPipeline`, `executeWritePlan`, or `mergeGroupFields`. Prioritize contract tests across those boundaries, plus reload and interrupted-submit recovery.

Lint failures: `KnowledgeStudio.tsx:121`, `:129`, and `:203` violate `react-hooks/set-state-in-effect`; `MergeWorkspaceModal.tsx:55` violates `react/no-unescaped-entities`.

Authentication/session identity remains an explicitly open pilot item (KS-143). Submit trusts client-supplied candidates/groups and TypeScript casts instead of validating a server-owned plan. Before shared deployment, enforce session ownership, runtime request validation, operation limits, and server-side resolution/write gates. This is a documented pilot boundary, not an inferred requirement to replace the current infrastructure.

Suggested fix order: source identity and target policy → decision persistence → conflict gate and common standards pass → reliable submission/recovery → correct fields and generated metadata → gap task workflow → prompt/output validation and complete audit/cost reporting.
