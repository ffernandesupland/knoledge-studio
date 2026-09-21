import type { ContentProposal } from "../llm/planning";
import type { RunOutput } from "../pipeline/run";

/** View model the Check/Metadata/Submit screens render, mapped from a pipeline run. */

export type ActionTag = "New" | "Update" | "Merge";
export type SubmitStatus = "new" | "updated" | "merged" | "flagged";

export interface ViewDuplicate {
  solutionId: string;
  title: string;
  similarity: number;
  verdict: string;
  rationale: string;
}

export interface ViewCandidate {
  key: string;
  proposal?: ContentProposal;
  sourceLabels?: string[];
  targetSolutionId?: string;
  sourceVersion?: string;
  edited?: boolean;
  sourceIds?: string[];
  summary?: string;
  keywords?: string[];
  titleLocked?: boolean;
  researchOnly?: boolean;
  title: string;
  subtitle: string;
  action: ActionTag;
  source: string;
  why: string;
  templateName: string;
  fields: { fieldName: string; fieldValue: string }[];
  /** Pre-authoring source text; real content is authored from this at submit time. Empty for gaps. */
  rawContent: string;
  duplicates: ViewDuplicate[];
  /** Index into ViewRun.groups, or null when this candidate is in no merge set. */
  dupeGroup: number | null;
}

export interface ViewGroupMember {
  id: string;
  title: string;
  stat: string;
  retained: boolean;
}

export interface ViewDupeGroup {
  members: ViewGroupMember[];
  survivorId: string;
  averageSimilarity: number;
  reason: string;
}

export interface ViewRun {
  groundContext?: import("../ground-context/types").GroundContextSnapshot;
  candidates: ViewCandidate[];
  groups: ViewDupeGroup[];
  warnings?: string[];
  costUsd: number;
  steps: RunOutput["steps"];
}

export function mapRunToView(run: RunOutput): ViewRun {
  const groupIndexByMember = new Map<string, number>();
  run.groups.forEach((g, i) => g.members.forEach((m) => groupIndexByMember.set(m.id, i)));

  const groups: ViewDupeGroup[] = run.groups.map((g) => ({
    survivorId: g.survivorId,
    averageSimilarity: g.averageSimilarity,
    reason:
      g.rationales[0] ??
      "These cover the same topic. Merging keeps one solution and flags the rest.",
    members: g.members.map((m) => ({
      id: m.id,
      title: m.title,
      stat: m.isNew ? "New solution · no history yet" : `${m.viewCount.toLocaleString("en-US")} views`,
      retained: m.id === g.survivorId,
    })),
  }));

  const candidates: ViewCandidate[] = run.solutions.map((s) => {
    const groupIndex = groupIndexByMember.get(s.key) ?? null;
    const duplicates: ViewDuplicate[] = s.duplicates.map((d) => ({
      solutionId: d.solutionId,
      title: d.title,
      similarity: d.similarity,
      verdict: d.verdict,
      rationale: d.rationale,
    }));

    const action: ActionTag =
      groupIndex !== null ? "Merge" : s.sourceSolutionId ? "Update" : "New";

    const subtitle =
      duplicates.length === 0
        ? s.source === "Find gaps"
          ? "Suggested to fill a gap"
          : s.targetSolutionId ? "Proposed update" : "Proposed new article"
        : `${duplicates.length} possible duplicate${duplicates.length === 1 ? "" : "s"}`;

    return {
      key: s.key,
      proposal: s.proposal,
      sourceLabels: s.sourceLabels,
      targetSolutionId: s.targetSolutionId,
      sourceVersion: s.sourceVersion,
      sourceIds: s.sourceIds,
      summary: s.summary,
      keywords: s.keywords,
      titleLocked: s.titleLocked,
      researchOnly: s.researchOnly,
      title: s.title,
      subtitle,
      action,
      source: s.source,
      why: s.proposal?.rationale ?? s.rationale,
      templateName: s.templateName,
      fields: s.fields,
      rawContent: s.rawContent,
      duplicates,
      dupeGroup: groupIndex,
    };
  });

  return { groundContext: run.groundContext, candidates, groups, warnings: run.warnings, costUsd: run.costUsd, steps: run.steps };
}
