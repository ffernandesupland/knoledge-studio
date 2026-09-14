"use client";
import { useRef, useState } from "react";
import { submissionMermaid, type SubmissionGraphModel, type SubmissionRow, type GraphSource } from "@/lib/ks/submission-graph";
import type { ContentReview, OpResult } from "@/lib/pipeline/execute";
import { ArticlePreview } from "./ArticlePreview";

const statusLabel = (r?: OpResult) => r ? ({ ready: "Ready for review", ok: "Submitted to RightAnswers", error: "Failed", review: "Needs your review", uncertain: "Verify write outcome", skipped: "Waiting" }[r.outcome]) : "Planned";
export function SubmissionGraph({ model, busy = false, currentKey, mode = "preparation", onSave, onChangePlan, onDirtyChange, flowHref, decisionActor = "author", templates = [] }: {
  decisionActor?: "author" | "agent"; templates?: string[]; model: SubmissionGraphModel; busy?: boolean; currentKey?: string | null; mode?: "preparation" | "submission" | "history";
  onSave?: (key: string, review: ContentReview) => void; onChangePlan?: () => void; onDirtyChange?: (dirty: boolean) => void; flowHref?: string;
}) {
  const [selection, setSelection] = useState<{ key: string; source?: string; action?: boolean; comment?: string } | null>(null);
  const [view, setView] = useState<"graph" | "list">("graph");
  const [zoom, setZoom] = useState(1);
  const [editing, setEditing] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const row = model.rows.find((r) => r.key === selection?.key) ?? model.rows[0];
  const source = row?.sources.find((s) => s.id === selection?.source);
  const comment = row?.comments.find((c) => c.key === selection?.comment);
  const prepared = row?.result?.prepared;
  function choose(next: NonNullable<typeof selection>) { if (editing) return; setSelection(next); }
  function edit(value: boolean) { setEditing(value); onDirtyChange?.(value); }
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
            {model.rows.map((r) => <div className="sg-row" key={r.key}>
              {view === "graph" && <svg className="sg-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">{r.sources.map((s, i) => <path key={s.id} d={`M 26 ${(i + .5) * 100 / r.sources.length} C 34 ${(i + .5) * 100 / r.sources.length}, 34 50, 40 50`} />)}<path d="M 60 50 L 74 50" /></svg>}
              <div className="sg-sources">{r.sources.map((s) => <div key={s.id}>{node(r, "source", s)}</div>)}</div>
              <div className="sg-action-wrap">{node(r, "action")}</div>
              <div className="sg-output">{node(r, "result")}
                {r.comments.map((c) => <button type="button" className="sg-comment" key={c.key} disabled={editing} onClick={() => choose({ key: r.key, comment: c.key })}>↳ {c.result?.outcome === "ok" ? "Comment saved" : "Tracking comment"}: {c.title}<small>{statusLabel(c.result)} · after merge succeeds</small></button>)}
              </div>
            </div>)}
          </div>
        </div>
        <p className="sg-legend">Select a source, action or result to inspect it. Existing source articles remain in place. New proposals absorbed into a merge do not become separate articles.</p>
      </div>
      <aside className="sg-inspector" aria-label="Selected item details" aria-live="polite">
        {!row ? <p>No articles in this plan.</p> : <>
          <span className="sg-eyebrow">{source ? "Source material" : comment ? "Tracking comment" : selection?.action ? "Action details" : "Resulting article"}</span>
          <h2>{source?.title ?? comment?.title ?? prepared?.title ?? row.title}</h2>
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
            {prepared.metadata && <div className="sg-warning"><strong>Selected metadata</strong><p>Collections: {prepared.metadata.collections?.join(", ") ?? "Default / existing"}</p><p>Taxonomies: {prepared.metadata.taxonomies?.map(p => p.replaceAll("//", " › ")).join("; ") || "None / existing"}</p><p>Language: {prepared.metadata.language ?? "Default / existing"}</p></div>}
            {prepared.warnings.map((w, i) => <p className="sg-warning" key={i}>{w}</p>)}
            {editing && onSave ? <form key={prepared.version} onSubmit={(e) => {
              e.preventDefault(); const data = new FormData(e.currentTarget);
              onSave(row.key, { version: prepared.version, title: String(data.get("title")), summary: String(data.get("summary")), keywords: String(data.get("keywords")).split(",").map((s) => s.trim()).filter(Boolean), fields: prepared.fields.map((f, i) => ({ fieldName: f.fieldName, fieldValue: String(data.get(`field-${i}`)) })) }); edit(false);
            }}>
              <label>Title<input name="title" required maxLength={500} defaultValue={prepared.title} /></label>
              <label>Summary · plain text<textarea name="summary" maxLength={4000} defaultValue={prepared.summary} /></label>
              <label>Keywords, separated by commas<input name="keywords" defaultValue={prepared.keywords.join(", ")} /></label>
              {prepared.fields.map((f, i) => <label key={f.fieldName}>{f.fieldName} · HTML<textarea name={`field-${i}`} defaultValue={f.fieldValue} rows={7} /></label>)}
              {prepared.sections?.some((s) => s.conflict.present) && <label><input type="checkbox" required /> I resolved the conflicting claims using supported source content.</label>}
              <div className="sg-editor-actions"><button type="button" onClick={() => edit(false)}>Cancel edits</button><button type="submit" disabled={busy}>Save and validate draft</button></div>
            </form> : <><ArticlePreview article={prepared} />{onSave && row.result?.outcome !== "ok" && row.result?.outcome !== "uncertain" && <button type="button" className="ds-btn ds-btn-secondary" disabled={busy} onClick={() => edit(true)}>Edit final article</button>}</>}
            {onSave && row.kind === "create" && !row.merge && row.result?.outcome === "review" && !editing && <form className="sg-regenerate" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); onSave(row.key, { version: prepared.version, fields: prepared.fields, regenerate: true, templateName: String(data.get("template")) }); }}>
              <label>Template for regeneration<select name="template" defaultValue={prepared.templateName}>{[...new Set([prepared.templateName, ...templates])].map((t) => <option key={t}>{t}</option>)}</select></label>
              <button type="submit" disabled={busy}>Regenerate from saved sources</button><p>Creates a new draft version for review. Completed writes stay saved.</p>
            </form>}
            {prepared.sections && <details className="sg-contributions"><summary>Source contributions and conflicts</summary>{prepared.sections.map((s) => <section key={s.fieldName}><h3>{s.fieldName}</h3>{s.contributions.map((c, i) => <p key={i}><strong>{c.from}</strong>: {c.text}</p>)}{s.conflict.present && <div className="sg-warning"><strong>Conflicting claims — resolve before submitting</strong><p>{s.conflict.optionA.from}: {s.conflict.optionA.text}</p><p>{s.conflict.optionB.from}: {s.conflict.optionB.text}</p></div>}</section>)}</details>}
          </> : <><p>Planned result. Prepare drafts to see the combined article in its final template.</p><p>{row.reason}</p><ul>{row.coverage.map((c, i) => <li key={i}>{c}</li>)}</ul>{row.result?.message && <p role="alert">{row.result.message}</p>}</>}
          {flowHref && <details className="sg-engine"><summary>Engine details</summary><p>Preparation uses the selected merge, authoring and standards operations. Submission writes the reviewed version and then adds dependent tracking comments.</p><ul>{row.preparation.filter((p) => p.prompt).map((p, i) => <li key={i}>Prompt: <code>{p.prompt}</code></li>)}</ul><a href={flowHref} target="_blank" rel="noreferrer">Inspect recorded prompts, inputs and results ↗</a></details>}
        </>}
      </aside>
    </div>
  </section>;
}
