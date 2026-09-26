import Link from "next/link";
import type { ReactNode } from "react";
import styles from "./KnowledgeCreateV2Submission.module.css";

export function KnowledgeCreateV2Submission({
  resultCount,
  draftsReady,
  needsReview,
  allWritten,
  auditHref,
  notices,
  context,
  compliance,
  download,
  graph,
  verification,
  cost,
}: {
  resultCount: number;
  draftsReady: number;
  needsReview: number;
  allWritten: boolean;
  auditHref?: string;
  notices?: ReactNode;
  context?: ReactNode;
  compliance?: ReactNode;
  download?: ReactNode;
  graph: ReactNode;
  verification?: ReactNode;
  cost?: number;
}) {
  const heading = allWritten ? "Submission complete" : draftsReady ? "Review your prepared drafts" : "Prepare your review drafts";
  const description = allWritten ? "The saved results below show what was sent to RightAnswers." : draftsReady ? "Review each prepared article before sending it for approval. Nothing is published automatically." : "Prepare drafts to inspect the final article content. This does not write anything to RightAnswers.";
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><span className={styles.eyebrow}>REVIEW AND SUBMIT</span><h1>{heading}</h1><p>{description}</p></div>
      {auditHref && <details className={styles.audit}><summary>Audit details</summary><Link href={auditHref} target="_blank">Open recorded engine flow</Link></details>}
    </header>
    <section className={styles.summary} aria-label="Draft readiness">
      <div><strong>{resultCount}</strong><span>result{resultCount === 1 ? "" : "s"}</span></div>
      <div><strong>{draftsReady}</strong><span>prepared draft{draftsReady === 1 ? "" : "s"}</span></div>
      <div className={needsReview ? styles.attention : styles.clear}><span className="ms" aria-hidden="true">{needsReview ? "visibility" : "check_circle"}</span><strong>{needsReview || "No"}</strong><span>{needsReview === 1 ? "draft needs review" : needsReview ? "drafts need review" : "drafts need review"}</span></div>
    </section>
    {notices}
    {context}
    {compliance}
    {download && <div className={styles.utility}>{download}</div>}
    <section className={styles.results} aria-labelledby="v2-resulting-articles-title"><div className={styles.sectionHeading}><span className="ms" aria-hidden="true">article</span><div><h2 id="v2-resulting-articles-title">Resulting articles</h2><p>Use the list to review article readiness. Open the relationship map only when you need source-level detail.</p></div></div>{graph}</section>
    {verification}
    {cost != null && <p className={styles.cost}>Recorded AI cost: ${cost.toFixed(4)}</p>}
  </main>;
}
