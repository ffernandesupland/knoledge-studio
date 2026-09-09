# Changes following the implementation review

This supersedes the behavior described in the original review; the historical review is retained as the issue record. Parent-folder design documents remain historical references.

| Finding | Implemented correction |
| --- | --- |
| 1. Existing identity lost | Explicit update target, source IDs/version, deterministic source boundaries, correct keys and existing template retention. Splits into multiple topics keep the original intact. |
| 2. Conflicts discarded | Persist merge sections/options; pause before writing; human resolutions resume the versioned preparation. |
| 3. Reload changes decisions | One snapshot includes effective survivor groups, selection (including empty), templates, operations, standards, collection, language and drafts. Partial submissions restore. |
| 4. Retry duplication | No HTTP write retries; durable run lock; write-intent journal; success replay; reconciliation of unknown outcomes. |
| 5. Merge skips standards | Final standards pass covers merges and ordinary articles after conflict resolution; rule reports retained. |
| 6. Wrong primary field | Recognize semantic answer/body fields; otherwise map by template semantics or request correction. |
| 7. Metadata dropped | Preserve title/summary/keywords through planning and writing; respect user/optimized titles. |
| 8. Empty gap articles | Unselected research tasks blocked by planner; research action starts new analysis with supported answer material. Coverage checks read full articles and exclude failed retrieval. |
| 9. Recovery missing | Partial status, durable operation results, retry/review/reconciliation controls, strict streaming and per-survivor dependencies. |
| 10. Wrong flag IDs | Resolve actual successful survivor identity and use it in comments. |
| 11. Incomplete audit/cost | Record final payload, results, prompt versions, prompts/responses, tokens and estimated cost in both phases. |
| 12. Query injection | Searches in untrusted blocks; labels neutralized too; inspector uses real prompt builders. |

Also corrected: template validation, HTML allowlisting, formatted sandboxed previews, saved draft edits, server-side ownership/plan validation, shared/production API authentication, pending-revision protection, source-version checks, request limits, pinned DNS for URL ingestion, consistent batch dedupe rubric, runtime dedupe-output validation and lint failures.

The `/flow` explorer provides dynamic source/option controls, outcome branches, real prompt/schema examples, Mermaid export and authenticated run activity. The wizard opens it with its current options and run ID.

Validation uses mocked RA/AI services. No live KB writes or paid model evaluation were performed. Shared deployments need account configuration and HTTPS; the pilot access control is not an RA SSO integration.

## Final verification

- `npm run check`: TypeScript clean; 149 tests passed in 14 files.
- `npm run lint`: clean.
- `npm run build`: production compilation, type checking and route generation passed.
- Local HTTP: `/` and `/flow` returned 200; an invalid same-origin `/api/run` request returned 400 before any external call.
- The development server was left running at `http://127.0.0.1:3000`; the explorer is at `/flow`.
- No browser automation, paid model calls or live RightAnswers writes were used for validation.


## Planning-first Check screen

The Check stage now displays proposals rather than source content as an article preview. A dedicated `plan` reasoning call uses source text, selected actions, completed tool outcomes, warnings and duplicate evidence to return purpose, supported coverage, a substantive rationale and open questions. Exact topic-key validation prevents the planner from inventing write targets or dropping topics. The call runs even when optional operations are off; the UI explains this baseline planning behavior.

Tool selection stays constrained to enabled options. The planner synthesizes evidence rather than freely invoking tools. New-article templates remain suggestions until Metadata. Duplicate checks that did not run say “Not checked”; individual comparison reasons stay separate from the overall rationale. Human keep-separate decisions update the proposed action. Research suggestions remain blocked from submission.

Proposal scope persists server-side and accompanies the original evidence into later authoring/merging. It is explicitly not a source of facts. New merge sources retain raw content even before template fields are populated. Old saved runs need another analysis for detailed proposals. The explorer, production prompt catalog, audit version and exported Mermaid tree include the planning pass.


## Submission field mapping and preview investigation

The 11:22 partial run had Split topics and Find duplicates enabled, but restructuring disabled and no standards. Its first article selected AI Template with fields One-new through Nine; remapping had left all nine fields empty. Validation correctly stopped that item before any RA write. Seven other articles were saved from source-body fields, without a submission AI call, summary or keywords.

New creates now always compose fields and metadata for the final template. Rewriting remains optional; existing articles with rewriting disabled retain their original fields. Merge outputs also supply metadata. All writing paths sanitize HTML and reject embedded Markdown syntax; plain Markdown is converted to HTML. Previews expose the complete saved structure. The paused item can regenerate from its source into a suitable template for review without rewriting completed articles. Existing remote articles are not repaired automatically.
