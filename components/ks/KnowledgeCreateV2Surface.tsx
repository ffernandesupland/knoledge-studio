"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Operation, PathKey } from "@/lib/ks/data";
import styles from "./KnowledgeCreateV2Surface.module.css";

export type V2MasterAction = "create" | "deduplicate" | "merge" | "standards";

const MASTER_ACTIONS: Array<{ key: V2MasterAction; title: string; description: string; icon: string }> = [
  { key: "create", title: "Create new content", description: "Turn documents, links, or notes into structured new knowledge.", icon: "note_add" },
  { key: "deduplicate", title: "Deduplicate", description: "Find overlapping saved solutions before they create confusion.", icon: "content_copy" },
  { key: "merge", title: "Merge solutions", description: "Combine two or more saved solutions into one reviewed revision.", icon: "merge_type" },
  { key: "standards", title: "Apply content standards", description: "Apply the company or scoped standard to existing content.", icon: "rule" },
];

const CORE_GOALS = new Set([
  "Merge solutions",
  "Apply content standards",
  "Find duplicates",
]);

const goalCopy: Record<string, { title: string; description: string }> = {
  "Restructure content": { title: "Improve clarity", description: "Make the content easier to read and follow." },
  "Apply content standards": { title: "Apply content standards", description: "Use the company or scoped standard that matches this work." },
  "Find duplicates": { title: "Check for overlap", description: "Look for knowledge that already covers the same topic." },
  "Merge solutions": { title: "Merge selected articles", description: "Combine existing articles into one reviewed revision." },
  "Optimize for search": { title: "Improve findability", description: "Improve titles and keywords for search." },
  "Find gaps": { title: "Find missing knowledge", description: "Identify useful follow-up topics that are not covered yet." },
  "Discover and suggest metadata": { title: "Suggest metadata", description: "Recommend collections and taxonomy for each proposal." },
};

export function KnowledgeCreateV2Surface({
  customer,
  selectedPath,
  onPickMasterAction,
  onChangeMasterAction,
  sourceComposer,
  sourceSummary,
  operations,
  onToggleOperation,
  mergeMode,
  advanced,
}: {
  customer: ReactNode;
  selectedPath: PathKey | null;
  onPickMasterAction: (action: V2MasterAction) => void;
  onChangeMasterAction: () => void;
  sourceComposer: ReactNode;
  sourceSummary: string;
  operations: Operation[];
  onToggleOperation: (index: number) => void;
  mergeMode: boolean;
  advanced: ReactNode;
}) {
  const [moreGoalsOpen, setMoreGoalsOpen] = useState(false);
  const visibleGoals = operations.map((operation, index) => ({ operation, index })).filter(({ operation }) => !mergeMode || ["Merge solutions", "Restructure content", "Apply content standards"].includes(operation.name));
  const coreGoals = visibleGoals.filter(({ operation }) => CORE_GOALS.has(operation.name));
  const moreGoals = visibleGoals.filter(({ operation }) => !CORE_GOALS.has(operation.name));
  const selectedAdditionalGoals = moreGoals.filter(({ operation }) => operation.on);
  const availableAdditionalGoals = moreGoals.filter(({ operation }) => !operation.on);
  const enabledGoals = operations.filter((operation) => operation.on);

  function goalButton(operation: Operation, index: number) {
    const copy = goalCopy[operation.name] ?? { title: operation.name, description: operation.desc };
    return <button type="button" key={operation.name} className={styles.goal + (operation.on ? ` ${styles.goalSelected}` : "")} aria-pressed={operation.on} onClick={() => onToggleOperation(index)}>
      <span className={"ms " + styles.goalIcon} aria-hidden="true">{operation.icon}</span>
      <span className={styles.goalBody}><strong>{copy.title}</strong><span>{copy.description}</span></span>
      <span className={"ms " + styles.goalCheck} aria-hidden="true">{operation.on ? "check_circle" : "add_circle"}</span>
    </button>;
  }

  if (!selectedPath) {
    return <main className={styles.page}>
      <header className={styles.hero}>
        <div><span className={styles.eyebrow}>EARLY ACCESS</span><h1>Create knowledge with confidence</h1><p>Start with the primary task you need to complete. Knowledge Studio turns your material into a reviewable plan before anything changes.</p></div>
        <Link className="ds-btn ds-btn-secondary" href="/knowledge-studio/create">Use classic Create</Link>
      </header>
      {customer}
      <section className={styles.launcher} aria-labelledby="v2-start-title">
        <div><h2 id="v2-start-title">What is your primary task?</h2><p>Choose one clear starting point. You can add supporting goals before building the plan.</p></div>
        <div className={styles.intentGrid}>{MASTER_ACTIONS.map((action) => <button type="button" className={styles.intent} key={action.key} onClick={() => onPickMasterAction(action.key)}><span className="ms" aria-hidden="true">{action.icon}</span><strong>{action.title}</strong><span>{action.description}</span></button>)}</div>
      </section>
    </main>;
  }

  return <main className={styles.page}>
    <header className={styles.heroCompact}>
      <div><span className={styles.eyebrow}>KNOWLEDGE CREATE V2</span><h1>{mergeMode ? "Merge saved articles" : "Create a reviewable knowledge plan"}</h1><p>Nothing is created or published until you review the plan.</p></div>
      <div className={styles.headerActions}><button type="button" className="ds-btn ds-btn-secondary" onClick={onChangeMasterAction}>Change primary task</button><Link className="ds-btn ds-btn-secondary" href="/knowledge-studio/create">Use classic Create</Link></div>
    </header>
    {customer}
    <ol className={styles.progress} aria-label="Create plan steps"><li className={styles.current}>1. Add material</li><li>2. Choose results</li><li>3. Review plan</li></ol>
    <section className={styles.section} aria-labelledby="v2-source-title">
      <div className={styles.sectionHeading}><span className="ms" aria-hidden="true">upload_file</span><div><h2 id="v2-source-title">{mergeMode ? "Select saved articles" : "Add your material"}</h2><p>{mergeMode ? "Choose two or more existing articles. Their original content stays available for review." : "Paste text, add a link, upload files, or search saved articles. You can mix sources."}</p></div></div>
      {sourceComposer}
    </section>
    <section className={styles.section} aria-labelledby="v2-goals-title">
      <div className={styles.sectionHeading}><span className="ms" aria-hidden="true">target</span><div><h2 id="v2-goals-title">What should happen?</h2><p>Choose the results you want. You can adjust these before reviewing the plan.</p></div></div>
      <div className={styles.goalGrid}>{coreGoals.map(({ operation, index }) => goalButton(operation, index))}</div>
      {selectedAdditionalGoals.length > 0 && <div className={styles.selectedAdditionalGoals}><p>Additional goals selected</p><div className={styles.goalGrid}>{selectedAdditionalGoals.map(({ operation, index }) => goalButton(operation, index))}</div></div>}
      {availableAdditionalGoals.length > 0 && <div className={styles.moreGoals}><button type="button" className="ds-btn ds-btn-secondary" aria-expanded={moreGoalsOpen} onClick={() => setMoreGoalsOpen((open) => !open)}><span className="ms" aria-hidden="true">tune</span>{moreGoalsOpen ? "Hide additional goals" : `Add another goal (${availableAdditionalGoals.length})`}</button>{moreGoalsOpen && <div className={styles.goalGrid}>{availableAdditionalGoals.map(({ operation, index }) => goalButton(operation, index))}</div>}</div>}
    </section>
    <details className={styles.advanced}><summary><span><span className="ms" aria-hidden="true">settings</span><strong>Advanced settings</strong></span><small>Reference material, instructions, limits, and automation</small></summary><div className={styles.advancedBody}>{advanced}</div></details>
    <aside className={styles.preflight} aria-label="Plan summary"><div><strong>Ready to review a plan</strong><span>{sourceSummary}</span></div><div className={styles.goalTags}>{enabledGoals.map((goal) => <span key={goal.name}>{goalCopy[goal.name]?.title ?? goal.name}</span>)}</div></aside>
  </main>;
}
