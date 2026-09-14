# Metadata lab

Open `/metadata-lab` or use **Metadata lab** in the Knowledge Studio header. The header link opens a separate tab to preserve any article work in progress.

1. Search by terms (with pagination) or load an exact solution ID.
2. Inspect its text and current collections, taxonomies and attributes.
3. Run **Research metadata**. Progress shows article analysis, similar-solution search, taxonomy exploration and recommendation.
4. Compare current assignments with suggested additions, read the short reasons and source excerpts, and inspect supporting examples and coverage.
5. Export the research as JSON for evaluation. Results remain in the current page until another search/run or navigation; this prototype does not save a research history.

The module only reads RightAnswers. It does not update articles, assign metadata, create categories or change the normal authoring workflow.

## Engine boundaries

The engine generates up to two queries, retrieves examples with Hybrid search, requires a published read status, and excludes the target, directly linked revisions, repeated IDs and normalized duplicate titles. It loads the actor's searchable collections, discovers taxonomy paths through search and `/browsepaths`, and explores up to three branches per round for three rounds. Very large candidate levels are shortlisted lexically using generated product/topic terms; this is bounded prototype retrieval, not a complete semantic catalog index.

Up to 80 collections, 100 taxonomy paths and 40 observed attribute values reach the final model. Attribute suggestions are limited to examples with the same nonempty attribute set as the target. Observed-only options are marked unverified. Current target labels are excluded from model prompts so the evaluation does not simply reproduce them; they are compared after selection.

Recommendations must reference a supplied candidate and any cited examples must belong to the retrieved set. Every suggestion must include an excerpt that matches the target article text. Unknown IDs, duplicate selections and fabricated excerpts fail the run. Semantic correctness still needs human validation; these checks do not establish that the classification or example rationale is correct.

Collection publication permissions and complete administrative attribute/taxonomy catalogs remain unverified. Empty taxonomy nodes may be absent. Solution fields receive a shared text budget, and shortening is disclosed. Existing embedded images and document attachments are not fetched by this prototype. Large attribute arrays are bounded before reaching the model.

All reads use the authenticated actor; no cross-user catalog cache is used. Routes are covered by the existing authentication proxy and repeat authentication inside the handler. Analysis streams progress/result/error events and checks cancellation between stages; an already running upstream request may finish after cancellation. Vercel max duration is 300 seconds. A disconnected or failed run does not show a partial report as a completed result.

## Validation

Unit tests cover example exclusions, unknown/duplicate recommendations, invalid citations, large candidate shortlists, long field budgeting, actor propagation, exclusion of current labels from prompts and cancellation. A live QA/model run on “RightAnswers: Forgot Your Password” completed with two taxonomy suggestions and abstained on collections. This is a functional smoke test, not a classification-quality benchmark.

Production verification (2026-09-13): deployed as `dpl_J4YKDmwCv9X3jYe7n1HWhkp3ZcSC` at `https://knoledge-studio.vercel.app/metadata-lab`. A real authenticated production analysis completed with four suggestions and ten comparison examples. Browser checks passed for real search, exact-ID loading, unauthenticated API rejection, displaying the completed report, JSON export, mobile overflow and retry/error states. The UI display tests reused the real production report; the production analysis endpoint itself was exercised without mocking. Full suite: 253 tests passed; lint, TypeScript and production build passed.

## Guided pipeline integration

The optional **Discover and suggest metadata** operation is available in Content. It uses the guided workflow: selecting it turns off fully autonomous mode, because the suggestions are intended for human review in step 3. Existing six-operation saved runs remain readable.

In **Metadata → Suggested from your knowledge base**, research starts for each resulting write-plan article, after split/merge decisions. External merge survivors are included; excluded sources and merge flags do not get their own classification controls. Original uploaded source context remains available for interpretation, while the classifier is instructed to classify only the target article.

Users can select multiple collections and taxonomy paths, choose a language, apply an article's suggestions locally or as global defaults, and override/reset settings per result. Attribute suggestions remain exploratory in the separate lab until their administrative value catalog is validated. Collection codes are used internally and names appear in the controls. Additional taxonomy branches can be browsed on demand.

Research is saved by run, article key and a hash of the target content and merge sources. Changing metadata choices reuses the research; changing research inputs invalidates it. Research calls are recorded in the run's AI audit. Failed research can be retried, and manual metadata selection remains available. The server enforces run ownership and reconstructs research inputs from the canonical selected plan.

Explicit metadata follows global defaults, then per-result overrides. For existing articles, fields without an explicit choice retain their existing values; new articles fall back to the run defaults. Metadata choices are part of the submission identity, so changing them invalidates prepared approvals. The selected metadata is shown in draft review and reaches both create and revision payloads. Catalog values are checked again before submission.

QA integration finding (2026-09-13): direct updates to draft `260913091120357` with `minorSave=false` successfully changed collections and taxonomy while retaining the same ID and preserving all content fields. Content-only direct edits continue to use minor saves; published articles continue to create revisions. Empty or delimiter-only taxonomy values did **not** clear an existing taxonomy in this QA API. The UI prevents removing the final existing taxonomy locally, and the server blocks an empty global override on an existing classified article. Replace the path or manage complete removal in RightAnswers. New articles can have no taxonomy.

Pipeline verification (2026-09-13): 264 tests passed, plus lint, TypeScript and production builds. Local browser tests exercised two real research requests, distinct per-article settings, global inheritance, persistence/reload and server-generated dry-run write plans. A separate recorded-report UI test confirmed that changing a collection does not freeze inherited taxonomies or language. Production authenticated research and responsive step-3 UI passed on deployment `dpl_Ej5SWZYTwBtpPzNqneTQjhCXGdkX` (`https://knoledge-studio.vercel.app`). Production checks did not alter saved user decisions or write articles; the dedicated QA draft described above was used only to verify API update behavior.

Taxonomy routing and final recommendation IDs are constrained to retrieved values in the model response schema. Invalid evidence gets one bounded correction attempt, followed by server validation. Research cache version 3 invalidates reports generated before these constraints. Explanations describe supporting evidence rather than internal model reasoning.


## Autonomous integration (2026-09-13)

Select **Discover and suggest metadata** together with **Run fully autonomously**. After article and merge decisions, the same research engine evaluates each resulting article, including all merge contributions and the original ordered source context. It applies supported collections and taxonomies per article before preparation. Attributes remain research-only; language uses the existing autonomous choice (or explicit constraint).

Explicit collection/language constraints take priority. If research abstains, existing metadata is preserved and new articles use the global collection/language selected by the planner. No empty taxonomy replacement is sent. Each decision records the selected values, evidence, explanation, uncertainties and fallback policy in the autonomous activity log and saved flow.

Research advances one article per saved app step and resumes from checkpoints. Catalog values are validated during selection, before preparation, and immediately before submission. A research failure stops before any article preparation/write and can be resumed from saved analysis. With the option off, autonomous behavior remains unchanged.

Validation: 269 tests passed across 34 files, TypeScript and ESLint passed, production build passed. Final deployment: `dpl_HF2RfdsrkivbX4tdhVS488kzdZH8`, aliased to https://knoledge-studio.vercel.app. Browser verification confirmed simultaneous autonomous/research selection, guided suggestions and mobile layout. Runner tests cover separate per-article assignments, merged revisions, research failure/resumption, explicit constraints and abstention. Production browser verification did not create articles or change saved user decisions.
