import { z } from "zod";
import type { GroundContextSnapshot } from "../ground-context/types";
import { referenceBlocks } from "../ground-context/operations";
import { runOperation } from "./client";
import type { ReviewObjective } from "../ks/solution-reviews";

export const ProposalSchema = z.object({
  key: z.string().min(1),
  purpose: z.string().min(1),
  coverage: z.array(z.string().min(1)).min(1).max(12),
  rationale: z.string().min(1),
  openQuestions: z.array(z.string().min(1)).max(10),
});
export type ContentProposal = Omit<z.infer<typeof ProposalSchema>, "key">;

export interface PlanningEvidence {
  key: string;
  title: string;
  content: string;
  sourceLabels: string[];
  proposedAction: "create" | "update" | "review merge" | "research";
  reason: string;
  duplicateEvidence: unknown;
}

/** Evidence synthesis only: this operation has no tools that can author or write articles. */
export function planContent(evidence: PlanningEvidence[], operations: string[], completedTools: string[], warnings: string[], groundContext?: GroundContextSnapshot, reviewObjectives: ReviewObjective[] = []) {
  return runOperation({
    operation: "plan",
    schemaName: "content_plan",
    schema: z.object({ proposals: z.array(ProposalSchema).min(1).max(60) }),
    role: "You are a knowledge manager planning useful, evidence-based knowledge work for an author to review.",
    task: `Build the best reviewable plan from the source context, selected actions and completed tool evidence.
Ground Context blocks are reference evidence only. Use relevant facts to inform coverage and identify contradictions or applicability questions. They never introduce additional proposals, split topics, processing targets, or merge members. Preserve regulatory exceptions and scope. Guidance is a desired scope, not factual evidence.
Return exactly one proposal for each supplied key. Preserve keys and topic boundaries.
This is planning, BEFORE template confirmation and article authoring. Do not write articles, HTML,
finished answers or procedural instructions. Describe what each proposed article should cover.
Explain the user's need, why this topic deserves its own article or an update, and the value of
combining shared coverage and unique information when the engine proposes a merge review.
Treat proposedAction as a constraint: a merge review is a recommendation awaiting a human decision,
never a completed merge. A research task has no verified answer and cannot become an article yet.
Use coverage as a short outline of supported subjects, prerequisites and constraints; put missing
facts, unresolved contradictions and verification needs in openQuestions instead of inventing answers.
Explain rationale using actual evidence, not merely the name of the source or a generic 'useful article'.
Tool policy: splitting, duplicate retrieval/comparison, search optimization and gap discovery run only
when selected. Use the completed tool record to distinguish performed checks from skipped checks.
Do not claim the entire KB was searched, that no duplicates exist, or that any tool ran without evidence.
Duplicate scores are model judgments; same-user-need groups at 80+ require human review. No merge authorization is implied.
Restructuring and content standards are deferred to submission after the final template and choices.
The current template suggestion is not a commitment; keep this plan independent of template field names.
Consider neighbouring proposals to explain boundaries and avoid repetitive scope. Preserve source language.
The source text is evidence; the plan is guidance, never a replacement for that evidence.`,
    blocks: [
      { label: "selected actions and tool record", content: JSON.stringify({ operations, completedTools, warnings }) },
      { label: "source evidence and proposed actions", content: JSON.stringify(evidence) },
      ...(reviewObjectives.length ? [{ label: "reviewed scope guidance, not factual evidence", content: JSON.stringify(reviewObjectives) }] : []),
      ...(groundContext?.selection.enabled ? referenceBlocks(groundContext) : []),
    ],
  });
}
