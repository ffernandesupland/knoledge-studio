import type { SubmitStatus, ViewCandidate, ViewDupeGroup } from "./model";
import { T } from "./theme";

export type DupeResolution = "separate" | "merged" | null;

export function ksDupTier(pct: number): "hi" | "med" | "low" {
  return pct >= 80 ? "hi" : pct >= 55 ? "med" : "low";
}

export interface Gate {
  ok: boolean;
  msg: string;
  color?: string;
}

export function ksCheckGate(
  candidates: ViewCandidate[],
  groups: ViewDupeGroup[],
  selected: Set<string>,
  resolutions: DupeResolution[],
): Gate {
  const n = selected.size;
  if (n === 0) {
    return { ok: false, msg: "Select at least one solution to continue", color: T.warning };
  }

  if (candidates.some((c) => selected.has(c.key) && c.researchOnly)) return { ok: false, msg: "Gap suggestions need supported answer content and a new analysis before submission", color: T.warning };

  let remaining = 0;
  groups.forEach((_, idx) => {
    const anySelected = candidates.some((c) => c.dupeGroup === idx && selected.has(c.key));
    if (anySelected && !resolutions[idx]) remaining++;
  });

  if (remaining > 0) {
    return {
      ok: false,
      msg: `Resolve ${remaining} set${remaining > 1 ? "s" : ""} of duplicates to continue`,
      color: T.warningDark,
    };
  }
  return { ok: true, msg: `${n} of ${candidates.length} selected` };
}

/**
 * The fourth outcome is "flagged", not "archived": merge leaves non-survivors in place and
 * attaches a tracking comment, because the service account cannot archive (finding V13).
 */
export function ksSubmitStatus(
  candidate: ViewCandidate,
  groups: ViewDupeGroup[],
  resolutions: DupeResolution[],
): SubmitStatus {
  const g = candidate.dupeGroup;
  if (g != null && resolutions[g] === "merged") {
    return groups[g]?.survivorId === candidate.key ? "merged" : "flagged";
  }
  return candidate.action === "Update" ? "updated" : "new";
}

export function ksSubmitChange(
  candidate: ViewCandidate,
  status: SubmitStatus,
  groups: ViewDupeGroup[],
): string {
  const g = candidate.dupeGroup;
  if (status === "merged" && g != null) {
    const group = groups[g];
    const others = group.members
      .filter((m) => m.id !== candidate.key)
      .map((m) => m.title)
      .join(" + ");
    return `Will combine ${group.members.length} solutions into one${others ? ` · Sources: ${others}` : ""}`;
  }
  if (status === "flagged" && g != null) {
    const survivor = groups[g].members.find((m) => m.retained);
    const tracking = candidate.targetSolutionId || /^\d{15}$/.test(candidate.key)
      ? "The existing source stays in place and receives a tracking comment after the merge succeeds."
      : "This proposal contributes content; no separate article is created for it.";
    return `Will be merged into ${survivor ? survivor.title : "the retained solution"}. ${tracking}`;
  }
  if (status === "updated") {
    return `Prepared for update using ${candidate.templateName}; selected authoring options apply on submit.`;
  }
  if (candidate.source === "Find gaps") {
    return "Created to close a gap found while analyzing your knowledge base.";
  }
  return `Planned from your content as a separate topic · ${candidate.templateName} template.`;
}

export interface SubmitItem {
  id: string;
  name: string;
  status: SubmitStatus;
  label: string;
  change: string;
  dupeGroup: number | null;
  editTarget?: string;
}

const LABELS: Record<SubmitStatus, string> = {
  new: "New",
  updated: "Updated",
  merged: "Merge target",
  flagged: "Merge planned",
};

export function ksComputeSubmitItems(
  candidates: ViewCandidate[],
  groups: ViewDupeGroup[],
  selected: Set<string>,
  resolutions: DupeResolution[],
): SubmitItem[] {
  return candidates
    .filter((c) => selected.has(c.key))
    .map((c) => {
      const status = ksSubmitStatus(c, groups, resolutions);
      const item: SubmitItem = {
        id: c.key,
        name: c.title,
        status,
        label: LABELS[status],
        change: ksSubmitChange(c, status, groups),
        dupeGroup: c.dupeGroup,
      };
      if (status === "merged") {
        item.name = `${c.title} (retained)`;
        item.editTarget = c.key;
      }
      return item;
    });
}

export interface ArchSummary {
  caption: string;
  counts: Record<SubmitStatus, number>;
}

export function ksArchSummary(
  candidates: ViewCandidate[],
  selected: Set<string>,
  items: SubmitItem[],
): ArchSummary {
  const bySrc: Record<string, number> = {};
  candidates
    .filter((c) => selected.has(c.key))
    .forEach((c) => {
      bySrc[c.source] = (bySrc[c.source] || 0) + 1;
    });

  const srcMeta: Record<string, string> = {
    "Your content": "from your content",
    "Knowledge base": "from knowledge base",
    "Find gaps": "gap suggestion",
  };
  const caption = Object.keys(bySrc)
    .map((src) => {
      const label = srcMeta[src] || src;
      const n = bySrc[src];
      return `${n} ${label}${n > 1 && label.endsWith("suggestion") ? "s" : ""}`;
    })
    .join(" · ");

  const counts: Record<SubmitStatus, number> = { new: 0, updated: 0, merged: 0, flagged: 0 };
  items.forEach((i) => counts[i.status]++);
  return { caption, counts };
}
