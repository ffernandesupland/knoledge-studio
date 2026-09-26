import type { ReactNode } from "react";
import styles from "./KnowledgeCreateV2Metadata.module.css";

export function KnowledgeCreateV2Metadata({
  resultCount,
  ready,
  error,
  groundContext,
  sharedSettings,
  publishingSettings,
  exceptions,
}: {
  resultCount: number;
  ready: boolean;
  error?: string | null;
  groundContext?: ReactNode;
  sharedSettings: ReactNode;
  publishingSettings: ReactNode;
  exceptions: ReactNode;
}) {
  return <main className={styles.page}>
    <header className={styles.header}>
      <span className={styles.eyebrow}>PUBLISHING SETTINGS</span>
      <h1>Confirm how your results will be published</h1>
      <p>Set shared defaults once. Only results that need a different template or classification require an exception.</p>
    </header>
    <section className={styles.summary} aria-label="Publishing readiness">
      <div><strong>{resultCount}</strong><span>result{resultCount === 1 ? "" : "s"} to prepare</span></div>
      <div className={ready ? styles.ready : styles.needsAttention}><span className="ms" aria-hidden="true">{ready ? "check_circle" : "error"}</span><strong>{ready ? "Ready for draft preparation" : "Publishing details needed"}</strong><span>{ready ? "Collection and language are set." : "Complete the required publishing fields below."}</span></div>
    </section>
    {groundContext}
    {error && <p className={styles.error} role="alert">Could not load RightAnswers options: {error}</p>}
    <section className={styles.card} aria-labelledby="v2-shared-settings-title"><div className={styles.cardHeading}><span className="ms" aria-hidden="true">tune</span><div><h2 id="v2-shared-settings-title">Shared settings</h2><p>These defaults apply to each eligible result unless you add an exception below.</p></div></div>{sharedSettings}</section>
    <section className={styles.card} aria-labelledby="v2-publishing-settings-title"><div className={styles.cardHeading}><span className="ms" aria-hidden="true">assignment_turned_in</span><div><h2 id="v2-publishing-settings-title">Required publishing details</h2><p>These values are checked before a draft can be prepared for review.</p></div></div>{publishingSettings}</section>
    <section className={styles.exceptions} aria-labelledby="v2-exceptions-title"><div><span className={styles.eyebrow}>EXCEPTIONS</span><h2 id="v2-exceptions-title">Adjust an individual result only when needed</h2><p>Results inherit the shared settings by default.</p></div>{exceptions}</section>
  </main>;
}
