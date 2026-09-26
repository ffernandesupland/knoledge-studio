"use client";

import Link from "next/link";
import type { ViewCandidate } from "@/lib/ks/model";
import type { DupeResolution } from "@/lib/ks/helpers";
import styles from "./KnowledgeCreateV2PlanReview.module.css";

function actionLabel(candidate: ViewCandidate, resolution: DupeResolution | undefined) {
  if (candidate.researchOnly) return "Research task";
  if (candidate.dupeGroup != null && resolution === "separate") return candidate.targetSolutionId ? "Update article" : "Create article";
  if (candidate.dupeGroup != null) return "Merge articles";
  return candidate.action === "Update" ? "Update article" : "Create article";
}

export function KnowledgeCreateV2PlanReview({
  candidates,
  selected,
  resolutions,
  duplicatesEnabled,
  mergeMode,
  costUsd,
  flowHref,
  onToggle,
  onToggleAll,
  onOpenDetails,
  onReviewMerge,
}: {
  candidates: ViewCandidate[];
  selected: Set<string>;
  resolutions: DupeResolution[];
  duplicatesEnabled: boolean;
  mergeMode: boolean;
  costUsd?: number;
  flowHref?: string;
  onToggle: (key: string) => void;
  onToggleAll: () => void;
  onOpenDetails: (candidate: ViewCandidate) => void;
  onReviewMerge: (groupIndex: number) => void;
}) {
  const actionable = candidates.filter((candidate) => !candidate.researchOnly);
  const selectedCount = [...selected].filter((key) => actionable.some((candidate) => candidate.key === key)).length;
  const updates = candidates.filter((candidate) => candidate.action === "Update").length;
  const merges = new Set(candidates.filter((candidate) => candidate.dupeGroup != null && resolutions[candidate.dupeGroup] !== "separate").map((candidate) => candidate.dupeGroup)).size;

  return <main className={styles.page}>
    <header className={styles.header}>
      <div>
        <span className={styles.eyebrow}>PLAN REVIEW</span>
        <h1>{mergeMode ? "Confirm the merge plan" : "Review the proposed changes"}</h1>
        <p>{mergeMode ? "Confirm which saved articles will be combined before preparing a reviewed revision." : "Choose the changes you want to continue with. Nothing has been created or updated yet."}</p>
      </div>
      {flowHref && <details className={styles.audit}><summary>Audit details</summary><Link href={flowHref} target="_blank">Open recorded engine flow</Link></details>}
    </header>

    <section className={styles.summary} aria-label="Plan summary">
      <div><strong>{selectedCount}</strong><span>selected result{selectedCount === 1 ? "" : "s"}</span></div>
      <div><strong>{updates}</strong><span>update{updates === 1 ? "" : "s"}</span></div>
      <div><strong>{merges}</strong><span>merge decision{merges === 1 ? "" : "s"}</span></div>
      {costUsd != null && <small>Analysis cost: ${costUsd.toFixed(3)}</small>}
    </section>

    <section className={styles.list} aria-labelledby="v2-plan-results-title">
      <div className={styles.listHeader}>
        <div><h2 id="v2-plan-results-title">Results to review</h2><p>Open a result to inspect its full scope, evidence, and proposed plan.</p></div>
        {actionable.length > 0 && <button type="button" className="ds-btn ds-btn-secondary" onClick={onToggleAll}>{selectedCount === actionable.length ? "Clear selection" : "Select all"}</button>}
      </div>
      <div className={styles.cards}>
        {candidates.map((candidate) => {
          const resolution = candidate.dupeGroup == null ? undefined : resolutions[candidate.dupeGroup];
          const selectedResult = selected.has(candidate.key);
          const reasons = (candidate.proposal?.why?.length ? candidate.proposal.why : [candidate.why]).filter(Boolean).slice(0, 3);
          const duplicate = candidate.duplicates[0];
          const decision = candidate.dupeGroup != null
            ? resolution === "separate" ? "Kept separate" : resolution === "merged" ? "Merge approved" : "Review merge decision"
            : duplicate ? `${duplicate.similarity}% possible overlap`
            : candidate.researchOnly || !duplicatesEnabled ? "Not checked for overlap" : "No overlap found";
          return <article key={candidate.key} className={styles.card + (selectedResult ? ` ${styles.cardSelected}` : "")}>
            <div className={styles.cardTop}>
              {!candidate.researchOnly && <label className={styles.select}><input type="checkbox" checked={selectedResult} onChange={() => onToggle(candidate.key)} /><span>Select result</span></label>}
              <span className={styles.action}>{actionLabel(candidate, resolution)}</span>
            </div>
            <div className={styles.cardTitle}><div><h3>{candidate.title}</h3><p>{candidate.subtitle}</p></div><span className="ms" aria-hidden="true">{candidate.action === "Update" ? "edit_note" : candidate.dupeGroup != null ? "merge_type" : "note_add"}</span></div>
            <div className={styles.meta}><span>Template: {candidate.templateName}</span><span>{decision}</span></div>
            <div className={styles.reason}><strong>Why this result</strong><ul>{reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul></div>
            <div className={styles.cardActions}>
              {candidate.dupeGroup != null && <button type="button" className="ds-btn ds-btn-secondary" onClick={() => onReviewMerge(candidate.dupeGroup!)}>{resolution ? "Review merge choice" : "Review merge"}</button>}
              <button type="button" className="ds-btn ds-btn-secondary" onClick={() => onOpenDetails(candidate)}>View full plan</button>
            </div>
          </article>;
        })}
      </div>
    </section>
  </main>;
}
