import type { ReactNode } from "react";
import styles from "./KnowledgeCreateV2Metadata.module.css";

export function KnowledgeCreateV2Metadata({
  resultCount,
  ready,
  error,
  groundContext,
  classification,
  templateSettings,
}: {
  resultCount: number;
  ready: boolean;
  error?: string | null;
  groundContext?: ReactNode;
  classification: ReactNode;
  templateSettings?: ReactNode;
}) {
  return <main className={styles.page}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>CLASSIFY RESULTS</span>
      <h1>Choose where each solution belongs</h1>
      <p>Review evidence-backed collection and taxonomy suggestions. You can edit one solution at a time; shared defaults are available when they genuinely apply.</p>
    </header>
    <section className={styles.summary} aria-label="Classification readiness">
      <div><strong>{resultCount}</strong><span>solution{resultCount === 1 ? "" : "s"} to classify</span></div>
      <div className={ready ? styles.ready : styles.needsAttention}><span className="ms" aria-hidden="true">{ready ? "check_circle" : "error"}</span><strong>{ready ? "Ready for draft preparation" : "Publishing details needed"}</strong><span>{ready ? "Collection and language are set." : "Complete the required publishing fields below."}</span></div>
    </section>
    {groundContext}
    {error && <p className={styles.error} role="alert">Could not load RightAnswers options: {error}</p>}
    <section className={styles.classification} aria-labelledby="v2-classification-title"><div className={styles.cardHeading}><span className="ms" aria-hidden="true">category</span><div><h2 id="v2-classification-title">Classification decisions</h2><p>Each recommendation is traceable to source evidence. Nothing is applied without your choice.</p></div></div>{classification}</section>
    {templateSettings && <section className={styles.templates} aria-labelledby="v2-template-title"><div className={styles.cardHeading}><span className="ms" aria-hidden="true">article</span><div><h2 id="v2-template-title">Content templates</h2><p>Set a default for new solutions, then make a solution-specific change only when its final format needs to differ.</p></div></div>{templateSettings}</section>}
  </main>;
}
