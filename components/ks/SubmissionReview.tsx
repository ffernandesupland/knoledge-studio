"use client";
import { useState } from "react";
import type { ContentReview, OpResult } from "@/lib/pipeline/execute";
import { ArticlePreview } from "./ArticlePreview";

export function SubmissionReview({ runId, results, onRetry, templates = [] }: { templates?: string[]; runId: string; results: OpResult[]; onRetry: (reviews?: Record<string, ContentReview>) => void }) {
  const [error, setError] = useState<string | null>(null);
  const reviews = results.filter((r) => r.outcome === "review" && r.prepared);
  const uncertain = results.filter((r) => r.outcome === "uncertain");
  return <div>
    {error && <p role="alert">{error}</p>}
    {!!reviews.length && <form onSubmit={(e) => {
      e.preventDefault();
      const data = new FormData(e.currentTarget);
      onRetry(Object.fromEntries(reviews.map((r, i) => [r.idempotencyKey, { version: r.prepared!.version, fields: r.prepared!.fields.map((f, j) => ({ fieldName: f.fieldName, fieldValue: String(data.get(`field-${i}-${j}`) ?? "") })) }])));
    }}>
      {reviews.map((r, i) => <section className="ks-card" key={`${r.idempotencyKey}:${r.prepared!.version}`}>
        <h3>Review: {r.prepared!.title}</h3><p>{r.message}</p>
        <p>Template: <strong>{r.prepared!.templateName}</strong></p>
        <details><summary>Preview full article</summary><ArticlePreview article={r.prepared!} /></details>
        {r.kind === "create" && !r.prepared!.sections && <div style={{ margin: "16px 0" }}>
          <label className="form-label" htmlFor={`template-${i}`}>Template for regeneration</label>
          <select id={`template-${i}`} name={`template-${i}`} className="form-input" defaultValue={r.prepared!.templateName}>
            {[...new Set([r.prepared!.templateName, ...templates])].map((t) => <option key={t}>{t}</option>)}
          </select>
          <button type="button" className="ds-btn ds-btn-secondary" onClick={(e) => {
            const value = (e.currentTarget.form?.elements.namedItem(`template-${i}`) as HTMLSelectElement)?.value;
            onRetry({ [r.idempotencyKey]: { version: r.prepared!.version, fields: r.prepared!.fields, regenerate: true, templateName: value } });
          }}>Regenerate from saved source</button>
          <p>Generates fields for review without writing. Completed articles are kept.</p>
        </div>}
        {r.prepared!.warnings.map((w, n) => <p key={n}>{w}</p>)}
        {r.prepared!.fields.map((f, j) => {
          const section = r.prepared!.sections?.find((s) => s.fieldName === f.fieldName);
          return <div key={f.fieldName} style={{ marginBottom: 20 }}>
            <label className="form-label" htmlFor={`field-${i}-${j}`}>{f.fieldName}</label>
            {section?.conflict.present && <div className="ks-merge-warn" style={{ display: "block" }}>
              <strong>These sources disagree. Choose supported facts or write your own resolution.</strong>
              {[section.conflict.optionA, section.conflict.optionB].map((option, k) => <div key={k} style={{ margin: "12px 0" }}>
                <p><strong>{option.from}</strong></p><ArticlePreview body={option.text} />
                <button type="button" className="ds-btn ds-btn-secondary" onClick={(e) => {
                  const field = e.currentTarget.form?.elements.namedItem(`field-${i}-${j}`) as HTMLTextAreaElement | null;
                  if (field) field.value = option.text;
                }}>Use this version</button>
              </div>)}
            </div>}
            <textarea id={`field-${i}-${j}`} name={`field-${i}-${j}`} defaultValue={f.fieldValue} className="form-input" style={{ width: "100%", minHeight: 140 }} />
          </div>;
        })}
      </section>)}
      <button className="ds-btn ds-btn-primary" type="submit">Apply these resolutions and retry unfinished writes</button>
    </form>}
    {uncertain.map((r) => <form className="ks-card" key={r.idempotencyKey} onSubmit={async (e) => {
      e.preventDefault(); setError(null);
      const data = new FormData(e.currentTarget);
      try {
        const response = await fetch("/api/submit/reconcile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, key: r.idempotencyKey, action: data.get("action"), solutionId: data.get("solutionId") || undefined, verified: data.get("verified") === "on" }) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error);
        onRetry();
      } catch (e) { setError((e as Error).message); }
    }}>
      <h3>Verify an interrupted write</h3><p>{r.description}</p><p>{r.message}</p>
      <label className="form-label">What did you find in RightAnswers?</label>
      <select name="action" className="form-input"><option value="confirm">The write completed</option><option value="retry">The write did not happen — allow a retry</option></select>
      {r.kind !== "flag" && <label className="form-label">Actual draft/revision ID (required when confirming)<input className="form-input" name="solutionId" pattern="[0-9]{15}" /></label>}
      <p><label><input type="checkbox" name="verified" required /> I checked RightAnswers and verified this outcome.</label></p>
      <button className="ds-btn ds-btn-secondary" type="submit">Record verification and continue</button>
    </form>)}
    {!reviews.length && results.some((r) => r.outcome === "error" || r.outcome === "skipped") && <button className="ds-btn ds-btn-primary" onClick={() => onRetry()}>Retry unfinished writes</button>}
  </div>;
}
