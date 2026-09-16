import type { PreparedContent } from "@/lib/pipeline/execute";
import styles from "./GroundContext.module.css";

export function GroundContextReport({ prepared }: { prepared: PreparedContent }) {
  if (!prepared.groundContext?.selection.enabled) return null;
  const report = prepared.grounding;
  return <section className={styles.evidence} aria-label="Ground Context evidence">
    <h3>Ground Context references</h3>
    <p>{prepared.groundContext.references.length} references available · {new Set(report?.evidence.map(item => item.referenceId)).size} cited in this draft</p>
    {!report && <p>Reference evidence will be checked when this draft is prepared.</p>}
    {report?.issues.map((issue, index) => <p key={index} className={styles.warning}>{issue}</p>)}
    {prepared.groundContext.references.map(reference => <details key={reference.id} className={styles.evidenceItem}>
      <summary>{reference.title} · {reference.id}</summary><small>Reference only · {reference.updated ? "Updated " + reference.updated : "Captured " + prepared.groundContext!.capturedAt}</small>
      {report?.evidence.filter(item => item.referenceId === reference.id).map((item, index) => <div key={index}><h4>{item.fieldName}</h4><p>{item.claim}</p><blockquote>{item.quote}</blockquote></div>)}
      {!report?.evidence.some(item => item.referenceId === reference.id) && <p>No citation from this reference in the current draft.</p>}
      <details><summary>View saved reference content</summary><p style={{ whiteSpace: "pre-wrap" }}>{reference.body}</p></details>
    </details>)}
  </section>;
}