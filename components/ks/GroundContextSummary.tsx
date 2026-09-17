"use client";
import { useState } from "react";
import type { GroundContextSnapshot, GroundingReport } from "@/lib/ground-context/types";
import { EvidenceDialog } from "./EvidenceDialog";
import styles from "./MetadataReview.module.css";

export function GroundContextSummary({ context, report, scope = "this draft" }: { context?: GroundContextSnapshot; report?: GroundingReport; scope?: string }) {
  const [open, setOpen] = useState(false);
  if (!context?.selection.enabled) return null;
  const used = new Set(report?.evidence.map(e => e.referenceId));
  return <section className={styles.context} aria-label="Selected reference knowledge">
    <div className={styles.heading}><div><strong>Reference knowledge · {context.references.length} {context.references.length === 1 ? "solution" : "solutions"}</strong><p>{report ? `${used.size} cited in ${scope}. Open the evidence map to see the exact information used.` : "AI will consult these solutions. Actual use and supporting excerpts will appear after draft preparation."}</p></div><button type="button" onClick={() => setOpen(true)}>View reference evidence</button></div>
    <ul>{context.references.map(r => <li key={r.id}><strong>{r.title}</strong> <small>#{r.id} · {report ? used.has(r.id) ? "Cited" : "No citation in this draft" : "Usage pending"}</small></li>)}</ul>
    {context.selection.guidance && <p><strong>Your guidance:</strong> {context.selection.guidance}</p>}
    {open && <EvidenceDialog title="How reference knowledge supports this article" onClose={() => setOpen(false)}>
      <p>These solutions supply reference information and remain unchanged. Each connection below links a saved excerpt to an exact passage in the draft.</p>
      {context.references.map(reference => {
        const evidence = report?.evidence.filter(e => e.referenceId === reference.id) ?? [];
        return <section key={reference.id} className={styles.evidenceGroup}><h3>{reference.title}</h3><small>#{reference.id} · {reference.status} · Snapshot {context.capturedAt}</small>
          {evidence.map((e, i) => <div className={styles.evidencePath} key={i} aria-label="Reference excerpt supports draft passage"><div><span className={styles.eyebrow}>Reference excerpt</span><blockquote>{e.quote}</blockquote></div><span className={styles.arrow} aria-label="supports">→</span><div><span className={styles.eyebrow}>Draft · {e.fieldName}</span><blockquote>{e.claim}</blockquote></div></div>)}
          {!evidence.length && <p>{report ? "No supporting citation was recorded for this reference. This does not establish why it was unused." : "Usage has not been checked yet. Prepare the draft to see exact supporting passages."}</p>}
          <details><summary>Read saved reference</summary><pre className={styles.source}>{reference.body}</pre></details>
        </section>;
      })}
      {report?.issues.map((issue, i) => <p key={i} role="alert" className={styles.warning}>{issue}</p>)}
    </EvidenceDialog>}
  </section>;
}
