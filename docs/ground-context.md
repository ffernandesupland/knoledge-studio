# Ground Context

Ground Context selects existing published KB solutions as reference evidence for creating or enriching an article. Reference selection is separate from selecting articles to process.

## Use it

1. In Knowledge Studio, choose Create, Improve, or Close a knowledge gap.
2. In Content, enable **Ground Context**.
3. Search the KB and select up to eight published reference solutions. Preview their content and optionally describe how they apply.
4. Add the task, source content, or article to improve, then create the plan.
5. Prepare drafts. Inspect **Ground Context references** in the final-article review to see supporting excerpts and outstanding issues.
6. Edit and validate unresolved drafts before submission.

The separate **AI Solution View** page contains a searchable interactive mockup with fictional references and illustrative output. It makes no model calls. The Content-step feature uses the authenticated KB and pipeline.

## Behavior

- References apply to the run. They are not split into topics and are excluded from duplicate merge candidates.
- Server-side checks reject reference IDs in update, merge, or tracking-comment targets.
- A solution cannot be both a processing target and an active reference.
- References alone are not a creation task: supply a task or source content.
- Ground Context can enrich existing content with restructuring disabled. Existing authoring and merge operations run first; reference enrichment then supplies relevant additions; standards and final evidence review follow.
- The model sees labeled REFERENCE ONLY blocks. Reference text and scope guidance remain untrusted data.
- Output includes reference IDs, quotes, output field names, and claims. The server validates IDs and normalized quote/claim membership. These checks establish traceability, not semantic or regulatory correctness.
- Final evidence review runs again after edits and standards. Unresolved issues keep the article in review.
- References are read with the current actor's permissions. Only published/live solutions with readable content are accepted.
- Up to eight references and 120,000 combined reference characters are accepted. The model-input guard counts both context and operation blocks.
- Reference content, status, version fingerprint, retrieval time, and guidance are saved with the run. Current access, status and content are checked before preparation and submission.
- Changed/unavailable references require a new analysis. Reference changes cannot silently reuse approved drafts.
- Saved snapshots survive reloads, draft regeneration, autonomous checkpoints and execution-history inspection.
- Existing runs without Ground Context retain their previous behavior.
- Disabling Ground Context retains selected IDs but does not use their content.

## Implementation map

- lib/ground-context/types.ts: selection schema, snapshots, evidence schema, review identity.
- lib/ground-context/server.ts: actor-scoped retrieval, eligibility, content limits, version checks and reference-only write guard.
- lib/ground-context/operations.ts: dedicated enrichment and final grounding-review prompts.
- components/ks/GroundContextInput.tsx: live Content-step search and selection.
- components/ks/GroundContextReport.tsx: saved references, supporting excerpts and issues.
- components/ks/GroundContext.tsx: demo picker and example evidence.
- run_ground_context: additive storage table; no destructive migration.
- Analysis, preparation and autonomous execution share the same saved reference snapshots.

## Verification

Targeted grounding, pipeline and autonomous test cases pass, including permission errors, unpublished/oversized references, fabricated citations, reference write attempts, conflicts, regeneration and version changes.

Browser checks cover the mockup on desktop/mobile and the live Content-step selection and request contract using intercepted API responses. No external model or customer-KB writes were performed.

On this Windows workstation, the full suite reports locked native database files during cleanup, an existing locale-sensitive view-count assertion, and a PDF parsing timeout under parallel load. These failures are outside the Ground Context assertions. The repository expects Node 22.

## Current scope

Manual KB selection, whole-run reference scope, text evidence from published solutions, guided and autonomous authoring. Automatic reference discovery, reference attachments/images, per-article selection and automatic verification of regulatory applicability are future work.