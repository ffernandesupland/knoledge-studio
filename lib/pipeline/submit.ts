import { effectiveMetadata, type MetadataSettings, type MetadataValues } from "../metadata/settings";
import type { ContentProposal } from "../llm/planning";
import type { DupeResolution } from "../ks/helpers";
import type { ViewCandidate, ViewDupeGroup } from "../ks/model";

/**
 * Turns Check-screen decisions into an explicit list of RightAnswers writes.
 *
 * Pure and exhaustively tested on purpose: this function decides what happens to live
 * customer-facing content, and it is the last place a mistake is cheap.
 */

/** Another group member whose real content must be folded into the survivor at write time. */
export interface MergeSource {
  id: string;
  title: string;
  proposal?: ContentProposal;
  rawContent?: string;
  /** Populated here when the member is a fresh draft; existing RA solutions are fetched live. */
  fields?: { fieldName: string; fieldValue: string }[];
  templateName?: string;
  edited?: boolean;
  sourceVersion?: string;
}

export type WriteOp =
  | {
      kind: "create";
      candidateKey: string;
      metadata?: MetadataValues;
      sourceVersion?: string;
      edited?: boolean;
      summary?: string;
      keywords?: string[];
      titleLocked?: boolean;
      title: string;
      templateName: string;
      fields: { fieldName: string; fieldValue: string }[];
      /**
       * Pre-authoring source text. When restructuring is enabled, the write is authored from
       * this against the final template at write time, instead of the draft `fields` above.
       */
      rawContent?: string;
      proposal?: ContentProposal;
      /** Other group members to fold in; the actual merge happens at write time. */
      mergeSources?: MergeSource[];
      idempotencyKey: string;
    }
  | {
      kind: "revise";
      candidateKey: string;
      metadata?: MetadataValues;
      /** Parent solution; its live content is never modified. */
      solutionId: string;
      sourceVersion?: string;
      edited?: boolean;
      summary?: string;
      keywords?: string[];
      titleLocked?: boolean;
      title: string;
      /**
       * Unset when this run never analyzed the target itself — the survivor was only ever seen
       * as a duplicate match. Its real template and current content are fetched live at write
       * time (see merge.ts) instead of being guessed here.
       */
      templateName?: string;
      fields?: { fieldName: string; fieldValue: string }[];
      /**
       * Pre-authoring source text. When restructuring is enabled, the write is authored from
       * this against the final template at write time, instead of the draft `fields` above.
       */
      rawContent?: string;
      proposal?: ContentProposal;
      /** True when this revision carries merged content from a duplicate group. */
      fromMerge: boolean;
      /** Other group members to fold in; the actual merge happens at write time. */
      mergeSources?: MergeSource[];
      idempotencyKey: string;
    }
  | {
      kind: "flag";
      solutionId: string;
      survivorLabel: string;
      survivorKey: string;
      idempotencyKey: string;
    };

export interface BuildPlanArgs {
  metadata?: MetadataSettings;
  runId: string;
  candidates: ViewCandidate[];
  groups: ViewDupeGroup[];
  selected: Set<string>;
  resolutions: DupeResolution[];
}

/** RA solution IDs are 15 digits; pipeline candidates use keys like "c0". */
export function isSolutionId(key: string): boolean {
  return /^\d{15}$/.test(key);
}

export function buildWritePlan(args: BuildPlanArgs): WriteOp[] {
  const { runId, candidates, groups, selected, resolutions } = args;
  const ops: WriteOp[] = [];
  if (candidates.some((c) => selected.has(c.key) && c.researchOnly)) throw new Error("Research suggestions cannot be submitted. Add an answer and analyze it first.");
  if ([...selected].some((key) => !candidates.some((c) => c.key === key))) throw new Error("Unknown selected candidate");
  groups.forEach((g, i) => {
    if (g.members.some((m) => selected.has(m.id)) && !resolutions[i]) throw new Error("Resolve duplicate groups before submitting");
    if (!g.members.some((m) => m.id === g.survivorId)) throw new Error("Survivor must belong to its group");
  });
  const mergedGroupIndexes = new Set<number>();

  // Merged groups are resolved once per group, not once per candidate: a group's survivor and
  // its other members are not always among this run's own candidates — an existing article can
  // be picked as survivor purely because it duplicate-matched something analyzed here.
  groups.forEach((group, groupIndex) => {
    if (resolutions[groupIndex] !== "merged") return;

    const survivorCandidate = candidates.find((c) => c.key === group.survivorId);
    if (survivorCandidate && !selected.has(survivorCandidate.key)) return;
    if (!survivorCandidate && !group.members.some((m) => selected.has(m.id))) return;

    mergedGroupIndexes.add(groupIndex);
    const survivorMember = group.members.find((m) => m.retained);
    const survivorLabel = survivorMember
      ? `${survivorMember.title} (${survivorMember.id})`
      : "the retained solution";

    // Deselecting one of this run's own candidates drops it from the merge entirely: not
    // written in, and not flagged. Members that were never this run's own candidates (found
    // purely as duplicate matches) have no checkbox and are always included.
    const isIncluded = (id: string) => {
      const own = candidates.find((c) => c.key === id);
      return !own || selected.has(id);
    };

    const mergeSources: MergeSource[] = group.members
      .filter((m) => m.id !== group.survivorId && isIncluded(m.id))
      .map((m) => ({ id: m.id, title: m.title, proposal: candidates.find((c) => c.key === m.id)?.proposal, rawContent: candidates.find((c) => c.key === m.id)?.rawContent, fields: candidates.find((c) => c.key === m.id)?.fields, templateName: candidates.find((c) => c.key === m.id)?.templateName, edited: candidates.find((c) => c.key === m.id)?.edited, sourceVersion: candidates.find((c) => c.key === m.id)?.sourceVersion }));

    if (survivorCandidate) {
      // The survivor takes the merged content. When it is an existing article the content
      // goes in as a revision, so the live record is untouched until someone approves it.
      if (survivorCandidate.targetSolutionId || isSolutionId(survivorCandidate.key)) {
        ops.push({
          kind: "revise",
          candidateKey: survivorCandidate.key,
          solutionId: survivorCandidate.targetSolutionId ?? survivorCandidate.key,
          title: survivorCandidate.title,
          sourceVersion: survivorCandidate.sourceVersion, edited: survivorCandidate.edited, summary: survivorCandidate.summary, keywords: survivorCandidate.keywords, titleLocked: survivorCandidate.titleLocked,
          templateName: survivorCandidate.templateName,
          fields: survivorCandidate.fields,
          rawContent: survivorCandidate.rawContent,
          proposal: survivorCandidate.proposal,
          fromMerge: true,
          mergeSources,
          idempotencyKey: `${runId}:revise:${survivorCandidate.key}`,
        });
      } else {
        ops.push({
          kind: "create",
          candidateKey: survivorCandidate.key,
          title: survivorCandidate.title,
          sourceVersion: survivorCandidate.sourceVersion, edited: survivorCandidate.edited, summary: survivorCandidate.summary, keywords: survivorCandidate.keywords, titleLocked: survivorCandidate.titleLocked,
          templateName: survivorCandidate.templateName,
          fields: survivorCandidate.fields,
          rawContent: survivorCandidate.rawContent,
          proposal: survivorCandidate.proposal,
          mergeSources,
          idempotencyKey: `${runId}:create:${survivorCandidate.key}`,
        });
      }
    } else {
      // The survivor is an existing article this run never authored itself.
      ops.push({
        kind: "revise",
        candidateKey: group.survivorId,
        solutionId: group.survivorId,
        title: survivorMember?.title ?? group.survivorId,
        fromMerge: true,
        mergeSources,
        idempotencyKey: `${runId}:revise:${group.survivorId}`,
      });
    }

    for (const m of group.members) {
      if (m.id === group.survivorId || !isIncluded(m.id)) continue;
      // A losing draft was never created, so there is nothing to flag.
      if (!isSolutionId(m.id)) continue;
      ops.push({
        kind: "flag",
        solutionId: m.id,
        survivorLabel,
        survivorKey: group.survivorId,
        idempotencyKey: `${runId}:flag:${m.id}`,
      });
    }
  });

  for (const c of candidates) {
    if (!selected.has(c.key)) continue;

    const groupIndex = c.dupeGroup;
    if (groupIndex != null && mergedGroupIndexes.has(groupIndex)) continue;

    // Not merged: update the source article if there was one, otherwise create.
    if (c.targetSolutionId || isSolutionId(c.key)) {
      ops.push({
        kind: "revise",
        candidateKey: c.key,
        solutionId: c.targetSolutionId ?? c.key,
        title: c.title,
        sourceVersion: c.sourceVersion, edited: c.edited, summary: c.summary, keywords: c.keywords, titleLocked: c.titleLocked,
        templateName: c.templateName,
        fields: c.fields,
        rawContent: c.rawContent,
        proposal: c.proposal,
        fromMerge: false,
        idempotencyKey: `${runId}:revise:${c.key}`,
      });
    } else {
      ops.push({
        kind: "create",
        candidateKey: c.key,
        title: c.title,
        sourceVersion: c.sourceVersion, edited: c.edited, summary: c.summary, keywords: c.keywords, titleLocked: c.titleLocked,
        templateName: c.templateName,
        fields: c.fields,
        rawContent: c.rawContent,
        proposal: c.proposal,
        idempotencyKey: `${runId}:create:${c.key}`,
      });
    }
  }

  for (const op of ops) if (op.kind !== "flag") { const value = effectiveMetadata(args.metadata, op.candidateKey); if (value) op.metadata = value; }

  // Flags run last so nothing is marked as merged before its survivor exists.
  const order = { create: 0, revise: 1, flag: 2 } as const;
  return ops.sort((a, b) => order[a.kind] - order[b.kind]);
}

export function describeOp(op: WriteOp): string {
  switch (op.kind) {
    case "create":
      return `Create "${op.title}" as a draft for review`;
    case "revise":
      return op.fromMerge
        ? `Add merged content to ${op.solutionId} as a new revision`
        : `Add updated content to ${op.solutionId} as a new revision`;
    case "flag":
      return `Comment on ${op.solutionId}: merged into ${op.survivorLabel}`;
  }
}
