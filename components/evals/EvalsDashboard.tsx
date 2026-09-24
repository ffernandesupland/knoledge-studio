"use client";

import { useEffect, useMemo, useState } from "react";
import type { EvalDashboardRubric } from "@/lib/evals/types";

const score = (value: number | null | undefined) => value == null ? "—" : `${value.toFixed(1)} / 100`;
const when = (value?: string) => value ? new Date(value).toLocaleString() : "—";

export function EvalsDashboard() {
  const [rubrics, setRubrics] = useState<EvalDashboardRubric[]>([]);
  const [selected, setSelected] = useState<EvalDashboardRubric | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/evals", { signal: controller.signal }).then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load evaluations");
      setRubrics(data.rubrics);
    }).catch(reason => { if (reason.name !== "AbortError") setError(reason.message ?? "Could not load evaluations"); }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);
  const total = useMemo(() => rubrics.reduce((sum, rubric) => sum + rubric.evaluationCount, 0), [rubrics]);
  const average = useMemo(() => {
    const weighted = rubrics.reduce((sum, rubric) => sum + (rubric.averageScore ?? 0) * rubric.evaluationCount, 0);
    return total ? weighted / total : null;
  }, [rubrics, total]);
  return <main className="ks-scroll" style={{ maxWidth: 1320, margin: "0 auto", padding: "34px 28px 56px" }}>
    <span className="ks-eyebrow">INTERNAL MEASUREMENT</span>
    <h1 style={{ margin: "8px 0" }}>Knowledge Studio Evals</h1>
    <p style={{ maxWidth: 830 }}>Compare scores by the action-specific dimensions that were actually applied. A draft is evaluated only against matching dimensions; evaluations are observational and never change readiness or publishing behavior.</p>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: 14, margin: "24px 0" }}>
      <section className="ks-card" style={{ padding: 18 }}><span className="ks-eyebrow">RUBRIC DIMENSIONS</span><strong style={{ display: "block", fontSize: 28, marginTop: 6 }}>{rubrics.length}</strong><small>Active, action-specific rubrics</small></section>
      <section className="ks-card" style={{ padding: 18 }}><span className="ks-eyebrow">EVALUATIONS</span><strong style={{ display: "block", fontSize: 28, marginTop: 6 }}>{total}</strong><small>Dimension scores saved</small></section>
      <section className="ks-card" style={{ padding: 18 }}><span className="ks-eyebrow">AVERAGE SCORE</span><strong style={{ display: "block", fontSize: 28, marginTop: 6 }}>{score(average)}</strong><small>Weighted across saved results</small></section>
    </div>
    {error && <p role="alert" className="sg-warning">{error}</p>}
    <section className="ks-card" style={{ overflowX: "auto", padding: 0 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}><thead><tr><th>Dimension</th><th>Applied action</th><th>Configuration</th><th>Evaluations</th><th>Average score</th><th>Latest evaluation</th><th aria-label="Actions" /></tr></thead><tbody>
        {rubrics.map(rubric => <tr key={rubric.id}><td><strong>{rubric.pipeline.dimensionLabel}</strong><small style={{ display: "block", marginTop: 5 }}>Revision {rubric.revision} · {rubric.rubric.criteria.length} criteria</small></td><td>{rubric.pipeline.action}</td><td>{rubric.compilerModel}<small style={{ display: "block", marginTop: 5 }}>Configuration {rubric.pipeline.configurationIdentity.slice(0, 12)} · Prompt {rubric.promptVersion}</small></td><td>{rubric.evaluationCount}</td><td><strong>{score(rubric.averageScore)}</strong></td><td>{when(rubric.latestResult?.createdAt)}<small style={{ display: "block", marginTop: 5 }}>{rubric.latestResult?.judgeModel ?? "—"}</small></td><td><button type="button" className="ds-btn ds-btn-secondary" onClick={() => setSelected(rubric)}>View rubric</button></td></tr>)}
        {!loading && !rubrics.length && <tr><td colSpan={7} style={{ padding: 28 }}>No action-specific evaluations yet. Prepare a draft and select <strong>Run evaluation</strong>. Legacy combined rubrics are retained for auditability but excluded from this active comparison view.</td></tr>}
        {loading && <tr><td colSpan={7} style={{ padding: 28 }}>Loading evaluation history…</td></tr>}
      </tbody></table>
    </section>
    {selected && <RubricDialog rubric={selected} onClose={() => setSelected(null)} />}
  </main>;
}

function RubricDialog({ rubric, onClose }: { rubric: EvalDashboardRubric; onClose: () => void }) {
  return <div className="entity-modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}><section className="entity-modal" role="dialog" aria-modal="true" aria-labelledby="eval-rubric-title" style={{ maxWidth: 900, maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
    <div className="entity-modal-hdr"><div className="entity-modal-title"><span className="ms" aria-hidden="true">analytics</span><div><span className="ks-eyebrow">FIXED DIMENSION RUBRIC</span><h2 id="eval-rubric-title">{rubric.rubric.title}</h2><p>{rubric.rubric.summary}</p></div></div><button type="button" className="ds-btn ds-btn-secondary" onClick={onClose}>Close</button></div>
    <div className="entity-modal-body" style={{ overflowY: "auto", flex: 1 }}><p><strong>{rubric.pipeline.dimensionLabel}</strong> · {rubric.pipeline.action} · Revision {rubric.revision} · {rubric.evaluationCount} saved evaluation{rubric.evaluationCount === 1 ? "" : "s"}</p><div style={{ display: "grid", gap: 10 }}>{rubric.rubric.criteria.map(criterion => <article className="ks-card" key={criterion.id} style={{ padding: 14 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 16 }}><h3 style={{ margin: 0 }}>{criterion.title}</h3><span className="ks-chip">Weight {criterion.weight}</span></div><p style={{ marginBottom: 6 }}>{criterion.description}</p><small><strong>Evidence:</strong> {criterion.evidenceRequired}</small></article>)}</div></div>
    <div className="entity-modal-footer"><span>Internal measurement only · Never blocks publishing</span><button type="button" className="ds-btn ds-btn-primary" onClick={onClose}>Done</button></div>
  </section></div>;
}
