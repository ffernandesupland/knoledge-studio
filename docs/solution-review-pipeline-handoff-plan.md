# Solution Review → Knowledge Studio: implementation plan

## Objective

Allow an author to move from a dynamic **AI Solution Review** or **AI Knowledge Creation** entry point into the governed Knowledge Studio pipeline without turning review output into an unbounded write capability.

The source of truth for facts remains the saved RightAnswers solution and any explicitly selected source evidence. Review findings guide scope; they are not factual source material and cannot authorize publication.

## Product decisions

- **AI Knowledge Creation** is a launch shortcut.
  - With a saved solution ID, it opens Knowledge Studio with that solution selected as the initial target.
  - Without a solution ID, it opens a clean Knowledge Studio Content step.
- **AI Solution Review** is dynamic. A customer can define any review, so a review does not need a one-to-one counterpart in the current pipeline operation list.
- Existing `operations` remain a closed, server-validated list. They control deterministic pipeline behavior.
- Review results can also create an open-ended `reviewObjective`. It is scope guidance for planning and authoring, not a custom tool, custom write operation, or model-authored system prompt.
- The default transition opens in the **same tab**. An optional new-tab link can be offered later.
- Opening Knowledge Studio never starts a model run or a write. The author explicitly starts analysis after reviewing the handoff summary.

## Target flow

```text
Solution Editor
  ├─ AI Knowledge Creation
  │    ├─ saved solution → create launch handoff → Knowledge Studio, target selected
  │    └─ no solution ID → Knowledge Studio, clean Content step
  │
  └─ Review Solution
       ├─ run configured dynamic reviews
       ├─ author selects findings and intended outcomes
       ├─ create review handoff
       └─ Knowledge Studio handoff summary → author starts analysis
            → Check → Metadata → Prepare drafts → Review drafts → Submit
```

## Data contracts

### 1. Persisted review

Create a durable review record rather than placing review text in the URL or browser state.

```ts
type SolutionReview = {
  id: string;
  author: string;
  connectionId: string;
  solutionId: string;
  sourceVersion: string;
  sourceSnapshot: SolutionSnapshot;
  definitionId: string;
  status: "complete" | "failed";
  createdAt: string;
};

type ReviewFinding = {
  id: string;
  reviewId: string;
  label: string;
  category: string; // customer-defined; not a pipeline enum
  severity: "info" | "warning" | "high";
  summary: string;
  recommendation: string;
  evidence: Evidence[];
  confidence?: number;
};
```

Every finding must retain source locations or quotes. A finding without evidence may be shown to the author but is routed as `needs-evidence`, never as an authoring fact.

### 2. Persisted handoff

```ts
type PipelineHandoff = {
  id: string;
  author: string;
  connectionId: string;
  kind: "creation" | "review";
  source?: { solutionId: string; sourceVersion: string; role: "target" | "reference" };
  selectedFindingIds: string[];
  nativeOperations: OperationName[];
  reviewObjectives: ReviewObjective[];
  requestedPath: "create" | "improve" | "gap";
  createdAt: string;
  consumedAt?: string;
};

type ReviewObjective = {
  id: string;
  label: string;
  instruction: string;
  findingIds: string[];
  evidence: Evidence[];
  disposition: "native" | "custom" | "needs-evidence";
};
```

The browser sends only `handoffId` when starting the run. The server loads and authorizes the full handoff.

## Atomic implementation sequence

### P0 — Lock the behavior contract

1. Add this document to the product/engineering decision record.
2. Confirm that the initial release supports `Improve this solution` for an existing solution and `Start from scratch` without one.
3. Confirm whether `Create related content from this solution` is in the first release. It requires a distinct source role so an existing solution is not accidentally revised.
4. Define supported review output limits: maximum findings, evidence size, objective count, and retention period.

**Acceptance:** Product agrees that custom review objectives cannot introduce new write permissions or bypass existing draft review.

### P1 — Make Solution View a real solution surface

1. Replace the fixed `SOL-1042` demo state in `components/ks/SolutionView.tsx` with a `solutionId` route parameter and selected RightAnswers connection.
2. Add a server route that reads the solution through the connection selected by the signed-in actor.
3. Render title, summary, keywords, template fields, collection, status, language, author, taxonomy, attributes, quality and version from the real solution.
4. Align the layout with the Solution Manager screenshots: top command bar, editor actions, rich content surface, and metadata/quality rail. Do not reproduce browser chrome.
5. Mark the old demo route clearly as development-only or remove it once the real route is complete.

**Acceptance:** Loading a 15-digit solution ID shows the saved RightAnswers solution and does not expose another customer’s connection or content.

### P2 — Establish source-version identity

1. Extract a reusable `solutionVersion()` identity for Solution View reads, review runs, handoffs and pipeline startup.
2. Include connection ID, solution ID, status, last-modified identity and content hash in the stored source identity.
3. Add a `checkSolutionVersion()` server helper.
4. Surface a clear stale state: “This solution changed after review. Refresh review or continue with the latest source.”

**Acceptance:** A stale handoff cannot silently produce a draft against a changed source.

### P3 — Define dynamic review schemas

1. Add `ReviewDefinition` records for customer-defined review name, instructions, result schema, enabled state and connection scope.
2. Define a stable structured finding response schema with label, category, severity, recommendation, evidence and confidence.
3. Run review definitions with a stable server-owned system prompt and an untrusted wrapper around solution content and customer instructions.
4. Store review results and individual findings in durable tables.
5. Add failure and partial-result states; a failed review never produces a handoff.

**Acceptance:** A customer-defined review can return a structured finding with evidence without changing the pipeline operation enum.

### P4 — Build the Review Solution modal

1. Add the existing analysis sections as real review cards: readability, tone, gap, semantic, styleguide and in-depth review.
2. Render each configured customer review as an additional card, preserving its name and result schema.
3. Show evidence, confidence and source location alongside every recommendation.
4. Add finding selection controls and a count of selected findings.
5. Add `Use selected findings in Knowledge Studio`; keep it disabled until at least one valid finding is selected.

**Acceptance:** An author can inspect, select and deselect independent findings without changing the source solution.

### P5 — Route findings deterministically

1. Create a server-side `routeFinding()` function.
2. Map known categories to native operations only when the mapping is explicit and valid.
   - style/format → `Apply content standards`
   - duplicate → `Find duplicates` plus merge-review intent
   - structural multi-topic concern → optional `Split topics`
   - missing knowledge → `Find gaps` and/or `needs-evidence`
3. Route all unmatched customer categories to `custom` review objectives.
4. Route unsupported factual recommendations to `needs-evidence`.
5. Never let client-provided category text select a write action directly.

**Acceptance:** Known findings preselect appropriate operations; unknown findings still reach the planner as bounded objectives.

### P6 — Create and authorize handoffs

1. Add handoff tables, repository functions and ownership checks.
2. Add `POST /api/solution-reviews/:id/handoffs` accepting selected finding IDs and a user-selected intent.
3. Re-read findings server-side, validate their review ownership and produce native operations plus review objectives.
4. Save only the handoff ID in the navigation URL: `/?handoff=<id>`.
5. Add an expiry/consumed policy so old handoffs cannot be replayed indefinitely.

**Acceptance:** Editing request JSON cannot inject objectives, another author’s review, solution IDs or operations into a handoff.

### P7 — Add the AI Knowledge Creation launcher

1. Replace the current demo action with `Open in Knowledge Studio`.
2. When a saved solution ID exists, show a small confirmation sheet:
   - Improve this solution — default
   - Create related content from this solution — only if approved in P0
   - Start a new content task
3. For `Improve`, create a creation handoff with the existing solution as a `target` and route to `/?handoff=<id>`.
4. For no solution ID, navigate directly to clean Knowledge Studio Content.
5. Require a saved source version before launching from an editor that can contain unsaved changes.

**Acceptance:** Existing solution launch always opens the pipeline with the correct connection and solution selected; no-ID launch has no hidden source.

### P8 — Bootstrap Knowledge Studio from a handoff

1. Add a server-side handoff loader to `app/page.tsx` and pass a sanitized bootstrap object to `KnowledgeStudio`.
2. Show a persistent “Started from…” summary in Content:
   - source title and ID
   - reviewed version/time
   - selected findings
   - native operations
   - custom objectives
   - evidence-needed warnings
3. Preselect the source solution and native operations but let the author adjust them.
4. Do not call `/api/run` until the author selects `Analyze selected workflow`.
5. Preserve normal reset behavior: reset clears the bootstrap state without mutating the original review.

**Acceptance:** A handoff opens on the Content step with understandable provenance and no automatic model call.

### P9 — Extend the pipeline input safely

1. Add server-only `reviewObjectives` to `RunInput`; do not accept them directly from the browser.
2. Resolve `handoffId` in `/api/run` and `/api/autonomous`, validate ownership and source version, then bind trusted objectives to the server-side input.
3. Include objectives in planning and authoring as “reviewed scope guidance, not evidence.”
4. Keep `OperationName` closed and preserve current validation/authorization for writes.
5. Require additional source evidence before authoring factual content for a `needs-evidence` objective.

**Acceptance:** A custom review changes the plan’s scope but cannot invent a tool, invoke an unapproved write, or be mistaken for source evidence.

### P10 — Apply special handling for dynamic outcomes

1. Existing-solution improvement: preserve the solution ID as target and disable splitting by default.
2. Split suggestion: require explicit author opt-in before generating multiple candidates.
3. Duplicate suggestion: re-run duplicate evidence and version checks; enter existing merge-review UI rather than auto-merging.
4. Missing evidence: render questions and allow uploads, KB selection or Ground Context before authoring.
5. Related-content creation: create a new candidate only after the author chooses that intent.

**Acceptance:** The Schedule M example yields evidence questions for unsupported details rather than invented procedure steps.

### P11 — Audit, lifecycle and observability

1. Record review definition version, source version, selected findings, generated plan, human decisions and write outcomes.
2. Redact raw file data and credentials from audit records.
3. Surface review/handoff/run linkage in the executed flow view.
4. Record counters for abandoned handoffs, stale-source blocks, evidence-needed blocks, draft preparation, submission and rejection.
5. Add cleanup for expired review artifacts and handoffs according to retention policy.

**Acceptance:** An operator can reconstruct why a draft was created and which human selected the originating review finding.

### P12 — Test and rollout

1. Unit tests: finding routing, unknown category, evidence requirement, version comparison, owner isolation and closed operation validation.
2. API tests: handoff creation, replay/expiry, cross-user access, source stale state and no-ID creation launch.
3. Pipeline tests: custom objective reaches planning but is labelled non-factual; it cannot trigger a write without reviewed drafts.
4. UI tests: launch confirmation, selected-finding persistence, handoff summary, no automatic analysis and Back navigation.
5. Pilot behind a feature flag for one customer connection; compare review-to-draft conversion, evidence blocks and post-review edits before broad release.

**Acceptance:** No user can reach a write endpoint from Solution Review without passing the existing Knowledge Studio prepare/review/submit gates.

## Recommended delivery slices

| Slice | Scope | Demonstrable outcome |
|---|---|---|
| 1 | P1, P2, P7 | Real Solution View can launch existing or clean Knowledge Studio safely |
| 2 | P3, P4 | Dynamic reviews produce durable, evidence-backed findings |
| 3 | P5, P6, P8 | Author can select review findings and arrive at a governed Studio handoff |
| 4 | P9, P10 | Custom review objectives influence plans without adding arbitrary operations |
| 5 | P11, P12 | Auditable, tested pilot rollout |

## Explicit non-goals for the first pilot

- No automatic publication from a review finding.
- No generic model-created tool or prompt that can call RightAnswers writes.
- No implicit splitting, merging or retirement of an existing solution.
- No use of a review recommendation as factual evidence.
- No migration of unsaved browser-editor content; authors save the source before launch.
