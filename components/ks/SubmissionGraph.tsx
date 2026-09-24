"use client";
import { useRef, useState } from "react";
import { submissionMermaid, type SubmissionGraphModel, type SubmissionRow, type GraphSource } from "@/lib/ks/submission-graph";
import type { ContentReview, OpResult } from "@/lib/pipeline/execute";
import { GroundContextReport } from "./GroundContextReport";
import { GroundContextSummary } from "./GroundContextSummary";
import { MetadataEvidence } from "./MetadataEvidence";
import { ArticlePreview } from "./ArticlePreview";
import type { EvaluationResponse } from "@/lib/evals/types";

const statusLabel = (r?: OpResult) => r ? ({ ready: "Ready for review", ok: "Submitted to RightAnswers", error: "Failed", review: "Needs your review", blocked: "Blocked by template", uncertain: "Verify write outcome", skipped: "Waiting" }[r.outcome]) : "Planned";
export function SubmissionGraph({ model, runId, busy = false, currentKey, mode = "preparation", onSave, onChangePlan, onDirtyChange, flowHref, decisionActor = "author", templates = [] }: {
  decisionActor?: "author" | "agent"; templates?: string[]; model: SubmissionGraphModel; runId?: string; busy?: boolean; currentKey?: string | null; mode?: "preparation" | "submission" | "history";
  onSave?: (key: string, review: ContentReview) => void; onChangePlan?: () => void; onDirtyChange?: (dirty: boolean) => void; flowHref?: string;
}) {
  const [selection, setSelection] = useState<{ key: string; source?: string; action?: boolean; comment?: string } | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState(false);
  const [metadataEvidence, setMetadataEvidence] = useState(false);
  const [standardsReport, setStandardsReport] = useState<NonNullable<OpResult["prepared"]> | null>(null);
  const [evaluation, setEvaluation] = useState<EvaluationResponse | null>(null);
  const [evaluationPending, setEvaluationPending] = useState<string | null>(null);
  const [evaluationError, setEvaluationError] = useState("");
  const viewport = useRef<HTMLDivElement>(null);
  const row = model.rows.find((r) => r.key === selection?.key) ?? model.rows[0];
  const source = row?.sources.find((s) => s.id === selection?.source);
  const comment = row?.comments.find((c) => c.key === selection?.comment);
  const prepared = row?.result?.prepared;
  function choose(next: NonNullable<typeof selection>) { if (editing) return; setSelection(next); }
  function edit(value: boolean) { setEditing(value); onDirtyChange?.(value); }
  async function runEvaluation(key: string) {
    if (!runId) return;
    setEvaluationPending(key); setEvaluationError("");
    try {
      const response = await fetch("/api/evals", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId, idempotencyKey: key }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not run the evaluation");
      setEvaluation(data);
    } catch (error) { setEvaluationError(error instanceof Error ? error.message : "Could not run the evaluation"); }
    finally { setEvaluationPending(null); }
  }
  function node(r: SubmissionRow, kind: "source" | "action" | "result", s?: GraphSource) {
    const selected = row?.key === r.key && (kind === "source" ? selection?.source === s?.id : kind === "action" ? selection?.action : !selection?.source && !selection?.action && !selection?.comment);
    const state = currentKey === r.key ? (mode === "submission" ? "Writing…" : "Preparing…") : statusLabel(r.result);
    return <button type="button" className={`sg-node sg-${kind} ${selected ? "sg-selected" : ""}`} aria-pressed={!!selected} disabled={editing}
      onClick={() => choose({ key: r.key, source: s?.id, action: kind === "action" })}>
      <span className="sg-eyebrow">{kind === "source" ? (s?.existing ? "Existing article" : "Content proposal") : kind === "action" ? "Planned action" : r.kind === "revise" ? "Revised article" : "New article"}</span>
      <strong>{kind === "source" ? s?.title : kind === "action" ? (r.merge ? "Merge sources" : r.kind === "revise" ? "Update article" : "Create article") : r.result?.prepared?.title ?? r.title}</strong>
      {kind === "source" ? <small>{s?.existing ? `ID ${s.id}` : "Not created separately"}{s?.retained && r.merge ? " · Retained destination" : ""}</small> : kind === "action" ? <small>{r.sources.length} source{r.sources.length === 1 ? "" : "s"}{r.merge && r.result?.outcome === "ok" ? " · Merged" : ""}</small> : <><small>{r.result?.prepared?.templateName ?? r.templateName ?? "Retained article’s template"}</small><span className={`sg-status sg-status-${r.result?.outcome ?? "planned"}`}>{state}</span></>}
    </button>;
  }
  return <section className="sg-studio" aria-label="Submission graph and draft review">
    <div className="sg-summary">
      <div><span className="sg-eyebrow">Resulting articles</span><strong>{model.rows.length} output{model.rows.length === 1 ? "" : "s"}</strong></div>
      <span>{model.counts.created} new</span><span>{model.counts.revised} revised</span><span>{model.counts.merged} merge group{model.counts.merged === 1 ? "" : "s"}</span><span>{model.counts.comments} tracking comment{model.counts.comments === 1 ? "" : "s"}</span>
    </div>
    <div className="sg-layout">
      <div className="sg-canvas-panel">
        <div className="sg-toolbar"><div role="group" aria-label="View"><button type="button" aria-pressed={view === "graph"} onClick={() => setView("graph")}>Graph</button><button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button></div>
          {view === "graph" && <div role="group" aria-label="Graph zoom"><button type="button" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(.5, z - .1))}>−</button><span>{Math.round(zoom * 100)}%</span><button type="button" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(1.5, z + .1))}>+</button><button type="button" onClick={() => setZoom(Math.min(1, (viewport.current?.clientWidth ?? 780) / 780))}>Fit</button></div>}
          <button type="button" onClick={() => { const url = URL.createObjectURL(new Blob([submissionMermaid(model)], { type: "text/plain" })); const a = document.createElement("a"); a.href = url; a.download = "submission-flow.mmd"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download graph</button>
        </div>
        <div className="sg-viewport" ref={viewport}>
          <div className={`sg-canvas sg-view-${view}`} style={view === "graph" ? { zoom, minWidth: 760 } : undefined}>
            {view === "graph" && <div className="sg-column-labels"><span>Sources</span><span>Actions</span><span>Results</span></div>}
            {model.rows.map((r) => <div className="sg-row" key={r.key}><div className="sg-primary-row">
              {view === "graph" && <svg className="sg-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{r.sources.map((s, i) => <path key={s.id} d={`M 26 ${(i + .5) * 100 / r.sources.length} C 34 ${(i + .5) * 100 / r.sources.length}, 34 50, 40 50`} />)}<path d="M 60 50 L 74 50" /></svg>}
              <div className="sg-sources">{r.sources.map((s) => <div key={s.id}>{node(r, "source", s)}</div>)}</div>
              <div className="sg-action-wrap">{node(r, "action")}</div>
              <div className="sg-output">{node(r, "result")}
                {!!r.comments.length && <button type="button" className="sg-comment" disabled={editing} onClick={() => choose({ key: r.key, comment: r.comments[0].key })}>↳ {r.comments.length} dependent tracking comment{r.comments.length === 1 ? "" : "s"}<small>{r.comments.every(comment => comment.result?.outcome === "ok") ? "All comments saved" : "Created automatically after this revision succeeds"}</small></button>}
              </div>
              </div>{r.groundContext?.selection.enabled && <div className="sg-reference-lane"><span className="sg-eyebrow">Reference solutions · unchanged</span>{r.groundContext.references.map(reference => { const report = r.result?.prepared?.grounding; const evidence = report?.evidence.filter(e => e.referenceId === reference.id); return <button type="button" className="sg-node sg-reference" key={reference.id} disabled={editing} onClick={() => choose({ key: r.key })}><strong>{reference.title}</strong><small>#{reference.id}</small><small>{report ? evidence?.length ? `Supports ${evidence.length} passage(s) → draft` : "No citation in this draft" : "Reference → usage pending"}</small>{evidence?.slice(0, 2).map((e, i) => <small key={i}>{e.fieldName}: {e.claim}</small>)}</button>; })}</div>}
            </div>)}
          </div>
        </div>
        <p className="sg-legend">Select a source, action or result to inspect it. Existing source articles remain in place. New proposals absorbed into a merge do not become separate articles.</p>
      </div>
      <aside className="sg-inspector" aria-label="Selected item details" aria-live="polite">
        {!row ? <p>No articles in this plan.</p> : <>
          <span className="sg-eyebrow">{source ? "Source material" : comment ? "Tracking comment" : selection?.action ? "Action details" : "Resulting article"}</span>
          <h2>{source?.title ?? comment?.title ?? prepared?.title ?? row.title}</h2>
          {!source && !comment && !prepared && <GroundContextSummary context={row.groundContext} />}
          {comment ? <><p>{comment.result?.message ?? `After the retained article is written successfully, add an internal comment to ${comment.sourceId} identifying the retained destination. The source stays in place.`}</p><p>{statusLabel(comment.result)}</p></> : source ? <>
            <p>{source.existing ? `Existing article · ${source.id}` : "Proposed topic · no article has been created"}</p>
            {source.labels?.length ? <p>From {source.labels.join(" · ")}</p> : null}
            <p>Template: {source.templateName ?? "Read from the existing article during preparation"}</p>
            {source.body ? <pre className="sg-source-text">{source.body}</pre> : <p>Full source content is retrieved during preparation. The recorded engine prompts contain the exact source content used.</p>}
          </> : selection?.action ? <>
            <p>{row.reason}</p>{row.similarity != null && <p>Group similarity: {row.similarity}% · AI assessment, confirmed by {decisionActor === "agent" ? "the agent’s" : "your"} merge decision.</p>}<p><strong>Destination:</strong> {row.destinationId ? `Retain article ${row.destinationId}; create its review draft or revision.` : "Create one new article for review."}</p>
            <h3>Preparation steps</h3><ol>{row.preparation.map((p, i) => <li key={i}>{p.label}</li>)}</ol><h3>Included sources</h3><ul>{row.sources.map((s) => <li key={s.id}>{s.title}{s.retained ? " (retained)" : ""}</li>)}</ul>
            {!!row.coverage.length && <><h3>Planned coverage</h3><ul>{row.coverage.map((c, i) => <li key={i}>{c}</li>)}</ul></>}
            {!!row.questions.length && <><h3>Open questions</h3><ul>{row.questions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
            {onChangePlan && <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={onChangePlan}>Change sources or merge decision</button>}
          </> : prepared ? <>
            <p className={`sg-status sg-status-${row.result?.outcome}`}>{statusLabel(row.result)}</p>
            {row.result?.message && <p>{row.result.message}</p>}
            {row.result?.outcome === "blocked" && <div className="sg-warning"><strong>Automatic preparation stopped safely.</strong><p>The retained article's template requires source-supported content that the selected merge sources did not provide. Change the merge target or source selection, or add supported source material; do not invent this field.</p>{onChangePlan && <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={onChangePlan}>Change merge or source selection</button>}</div>}
            {prepared.metadata && <div className="sg-warning"><strong>Selected metadata</strong><p>Collections: {prepared.metadata.collections?.join(", ") ?? "Default / existing"}</p><p>Taxonomies: {prepared.metadata.taxonomies?.map(p => p.replaceAll("//", " › ")).join("; ") || "None / existing"}</p><p>Language: {prepared.metadata.language ?? "Default / existing"}</p></div>}
            {prepared.metadataEvidenceChanged && <p className="sg-warning">The final wording differs from an accepted metadata suggestion’s original excerpt. Review the classification against this draft before approving it.</p>}
            {prepared.metadataResearch && <button type="button" onClick={() => setMetadataEvidence(true)}>Review metadata evidence map</button>}
            {!!Object.keys(prepared.metadataDecisions ?? {}).length && <details><summary>Metadata and attribute decisions</summary>{Object.entries(prepared.metadataDecisions ?? {}).map(([key, decision]) => <p key={key}><strong>{decision.label}</strong> · {decision.kind === "attribute" && decision.status === "accepted" ? "Kept for validation — not submitted" : decision.status}{decision.attributeSet ? ` · ${decision.attributeSet}` : ""}</p>)}</details>}
            {!!prepared.ruleResults?.length && <button type="button" className="ds-btn ds-btn-secondary" style={{ marginTop: 12 }} onClick={() => setStandardsReport(prepared)}>Review content standards</button>}
            {runId && <div style={{ marginTop: 12 }}><button type="button" className="ds-btn ds-btn-secondary" disabled={evaluationPending === row.key} onClick={() => void runEvaluation(row.key)}>{evaluationPending === row.key ? "Running evaluations…" : "Run applicable evaluations"}</button><small style={{ display: "block", marginTop: 7 }}>Only dimensions requested and applied in this pipeline are measured. It never changes readiness or publishing behavior.</small></div>}
            {evaluationError && <p className="sg-warning" role="alert">{evaluationError}</p>}
            {prepared.warnings.map((w, i) => <p className="sg-warning" key={i}>{w}</p>)}
            {editing && onSave ? <form key={prepared.version} onSubmit={(e) => {
              e.preventDefault(); const data = new FormData(e.currentTarget);
              onSave(row.key, { version: prepared.version, title: String(data.get("title")), summary: String(data.get("summary")), keywords: String(data.get("keywords")).split(",").map((s) => s.trim()).filter(Boolean), fields: prepared.fields.map((f, i) => ({ fieldName: f.fieldName, fieldValue: String(data.get(`field-${i}`)) })) }); edit(false);
            }}>
              <label>Title<input name="title" required maxLength={500} defaultValue={prepared.title} /></label>
              <label>Summary · plain text<textarea name="summary" maxLength={4000} defaultValue={prepared.summary} /></label>
              <label>Keywords, separated by commas<input name="keywords" defaultValue={prepared.keywords.join(", ")} /></label>
              {prepared.fields.map((f, i) => <label key={f.fieldName}>{f.fieldName} · HTML<textarea name={`field-${i}`} defaultValue={f.fieldValue} rows={7} /></label>)}
              {(prepared.sections?.some((s) => s.conflict.present) || prepared.grounding?.issues.length) && <label><input type="checkbox" required /> I resolved the conflicting claims using supported source content.</label>}
              <div className="sg-editor-actions"><button type="button" onClick={() => edit(false)}>Cancel edits</button><button type="submit" disabled={busy}>Save and validate draft</button></div>
            </form> : <><GroundContextReport prepared={prepared} /><ArticlePreview article={prepared} />{onSave && row.result?.outcome !== "ok" && row.result?.outcome !== "uncertain" && <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={() => edit(true)}>Edit final article</button>}</>}
            {onSave && row.kind === "create" && !row.merge && row.result?.outcome === "review" && !editing && <form className="sg-regenerate" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); onSave(row.key, { version: prepared.version, fields: prepared.fields, regenerate: true, templateName: String(data.get("template")) }); }}>
              <label>Template for regeneration<select name="template" defaultValue={prepared.templateName}>{[...new Set([prepared.templateName, ...templates])].map((t) => <option key={t}>{t}</option>)}</select></label>
              <button type="submit" disabled={busy}>Regenerate from saved sources</button><p>Creates a new draft version for review. Completed writes stay saved.</p>
            </form>}
            {prepared.sections && <details className="sg-contributions"><summary>Source contributions and conflicts</summary>{prepared.sections.map((s) => <section key={s.fieldName}><h3>{s.fieldName}</h3>{s.contributions.map((c, i) => <p key={i}><strong>{c.from}</strong>: {c.text}</p>)}{s.conflict.present && <div className="sg-warning"><strong>Conflicting claims — resolve before submitting</strong><p>{s.conflict.optionA.from}: {s.conflict.optionA.text}</p><p>{s.conflict.optionB.from}: {s.conflict.optionB.text}</p></div>}</section>)}</details>}
          </> : <><p>Planned result. Prepare drafts to see the combined article in its final template.</p><p>{row.reason}</p><ul>{row.coverage.map((c, i) => <li key={i}>{c}</li>)}</ul>{row.result?.message && <p role="alert">{row.result.message}</p>}</>}
          {flowHref && <details className="sg-engine"><summary>Engine details</summary><p>Preparation uses the selected merge, authoring and standards operations. Submission writes the reviewed version and then adds dependent tracking comments.</p><ul>{row.preparation.filter((p) => p.prompt).map((p, i) => <li key={i}>Prompt: <code>{p.prompt}</code></li>)}</ul><a href={flowHref} target="_blank" rel="noreferrer">Inspect recorded prompts, inputs and results ↗</a></details>}
        </>}
      </aside>
      {metadataEvidence && prepared?.metadataResearch && <MetadataEvidence report={prepared.metadataResearch} onClose={() => setMetadataEvidence(false)} />}
      {standardsReport && <ContentStandardsDialog prepared={standardsReport} onClose={() => setStandardsReport(null)} />}
      {evaluation && <EvaluationDialog evaluation={evaluation} onClose={() => setEvaluation(null)} />}
    </div>
  </section>;
}

function EvaluationDialog({ evaluation, onClose }: { evaluation: EvaluationResponse; onClose: () => void }) {
  return <div className="entity-modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="entity-modal" role="dialog" aria-modal="true" aria-labelledby="evaluation-result-title" style={{ maxWidth: 920, maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
      <div className="entity-modal-hdr"><div className="entity-modal-title"><span className="ms" aria-hidden="true">analytics</span><div><span className="ks-eyebrow">APPLICABLE EVALUATIONS</span><h2 id="evaluation-result-title">{evaluation.score.toFixed(1)} / 100</h2><p>{evaluation.evaluations.length} requested and applied dimension{evaluation.evaluations.length === 1 ? "" : "s"} measured for this draft.</p></div></div><button type="button" className="ds-btn ds-btn-secondary" aria-label="Close evaluation results" onClick={onClose}>Close</button></div>
      <div className="entity-modal-body" style={{ overflowY: "auto", flex: 1 }}>
        <p className="sg-warning">{evaluation.kpiEligible ? "This score is internal measurement only. It does not approve, block, edit, or publish this draft. It is included in comparison KPIs." : "Diagnostic evaluation only. This draft is incomplete or blocked, so its score is excluded from comparison KPIs and is not saved to the evaluation dashboard."}</p>
        <section className="ks-card" style={{ padding: 16, marginBottom: 14 }}><h3 style={{ marginTop: 0 }}>Evaluation coverage</h3><p>Only dimensions with enough saved evidence are scored. The remaining selected actions are shown explicitly rather than guessed.</p><div style={{ display: "grid", gap: 8 }}>{evaluation.coverage.map(item => <div key={item.dimension} style={{ borderTop: "1px solid #dfe1e6", paddingTop: 8, display: "grid", gridTemplateColumns: "minmax(150px, 1fr) auto", gap: 8 }}><div><strong>{item.label}</strong><small style={{ display: "block" }}>{item.reason}</small></div><span className="ks-chip">{item.status === "scored" ? "Scored" : item.status === "not_applicable" ? "Not applicable" : item.status === "blocked" ? "Diagnostic only" : "Not run"}</span></div>)}</div></section>
        <div style={{ display: "grid", gap: 14 }}>{evaluation.evaluations.map(({ rubric, result, cached }) => {
          const byId = new Map(result.judgment.criteria.map(criterion => [criterion.criterionId, criterion]));
          return <section key={rubric.id} className="ks-card" style={{ padding: 16 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}><div><span className="ks-eyebrow">{rubric.pipeline.action}</span><h3 style={{ margin: "4px 0" }}>{rubric.pipeline.dimensionLabel}</h3><small>Rubric revision {rubric.revision} · Judged by {result.judgeModel}{cached ? " · Loaded saved result" : ""}</small></div><strong style={{ fontSize: 22 }}>{result.score.toFixed(1)} / 100</strong></div><p>{result.judgment.summary}</p><div style={{ display: "grid", gap: 10 }}>{rubric.rubric.criteria.map(criterion => {
            const item = byId.get(criterion.id);
            return <article key={criterion.id} style={{ borderTop: "1px solid #dfe1e6", paddingTop: 10 }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 16 }}><div><h4 style={{ margin: 0 }}>{criterion.title}</h4><small>Weight {criterion.weight} · {item?.verdict?.replaceAll("_", " ") ?? "Not scored"}</small></div><strong>{item?.verdict === "not_applicable" ? "N/A" : `${item?.score ?? 0} / 4`}</strong></div><p style={{ margin: "8px 0 5px" }}>{item?.explanation ?? "No result was returned for this criterion."}</p>{item?.evidence.length ? <details><summary>Evidence</summary><ul>{item.evidence.map((evidence, index) => <li key={index}>{evidence}</li>)}</ul></details> : <small>{item?.verdict === "not_applicable" ? "Excluded from the weighted score." : "No supporting evidence was found."}</small>}</article>;
          })}</div></section>;
        })}</div>
      </div>
      <div className="entity-modal-footer"><span>Fixed rubrics · {evaluation.evaluations.length} applied dimension{evaluation.evaluations.length === 1 ? "" : "s"}</span><button type="button" className="ds-btn ds-btn-primary" onClick={onClose}>Done</button></div>
    </section>
  </div>;
}

function ContentStandardsDialog({ prepared, onClose }: { prepared: NonNullable<OpResult["prepared"]>; onClose: () => void }) {
  const results = prepared.ruleResults ?? [];
  const changed = results.filter(result => result.changed);
  const unchanged = results.filter(result => !result.changed);
  return <div className="entity-modal-scrim" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="entity-modal" role="dialog" aria-modal="true" aria-labelledby="content-standards-title" style={{ maxWidth: 920, maxHeight: "88vh", display: "flex", flexDirection: "column" }}>
      <div className="entity-modal-hdr"><div className="entity-modal-title"><span className="ms" aria-hidden="true">rule</span><div><span className="ks-eyebrow">CONTENT STANDARDS REPORT</span><h2 id="content-standards-title">What changed in {prepared.title}</h2><p>{changed.length} of {results.length} checks changed the draft. This report never changes the source article.</p></div></div><button type="button" className="ds-btn ds-btn-secondary" aria-label="Close content standards report" onClick={onClose}>Close</button></div>
      <div className="entity-modal-body" style={{ overflowY: "auto", flex: 1 }}>
        {prepared.standardsUsed?.length ? <section><h3>Instructions used for this solution</h3><p>The model received these frozen standards sources for this output.</p>{prepared.standardsUsed.map((standard, index) => <details key={`${index}-${standard.slice(0, 80)}`} open={prepared.standardsUsed!.length === 1}><summary>{standard.startsWith("[") ? standard.slice(1, standard.indexOf("]")) : `Standard ${index + 1}`}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 280, overflowY: "auto" }}>{standard.replace(/^\[[^\]]+\]\n/, "")}</pre></details>)}</section> : <p className="sg-warning">The exact instruction sources were not retained for this older prepared draft. New preparations show them here.</p>}
        <section style={{ marginTop: 22 }}><h3>Changes made</h3>{changed.length ? <div style={{ display: "grid", gap: 10 }}>{changed.map((result, index) => <article key={`${result.rule}-${index}`} className="ks-card" style={{ padding: 14 }}><span className="ks-chip" style={{ background: "#e7f5eb", color: "#216e39" }}>Changed</span><h4 style={{ margin: "10px 0 6px" }}>{result.rule}</h4><p style={{ margin: 0 }}>{result.note}</p><small>{result.passedBefore ? "The draft already met the rule; a compatible refinement was still made." : "The draft did not meet this rule before the edit."}</small></article>)}</div> : <p>No content changes were needed for the applied standards.</p>}</section>
        {!!unchanged.length && <details style={{ marginTop: 18 }}><summary>{unchanged.length} check{unchanged.length === 1 ? "" : "s"} with no change</summary><div style={{ display: "grid", gap: 10, marginTop: 10 }}>{unchanged.map((result, index) => <article key={`${result.rule}-${index}`} className="ks-card" style={{ padding: 14 }}><span className="ks-chip">No change</span><h4 style={{ margin: "10px 0 6px" }}>{result.rule}</h4><p style={{ margin: 0 }}>{result.note}</p><small>{result.passedBefore ? "Already compliant before preparation." : "No compatible content edit was made."}</small></article>)}</div></details>}
      </div>
      <div className="entity-modal-footer"><span>{prepared.standardsUsed?.length ?? 0} standards source{prepared.standardsUsed?.length === 1 ? "" : "s"} · {results.length} checks</span><button type="button" className="ds-btn ds-btn-primary" onClick={onClose}>Done</button></div>
    </section>
  </div>;
}
