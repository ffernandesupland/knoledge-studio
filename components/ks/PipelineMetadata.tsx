"use client";
import { useEffect, useRef, useState } from "react";
import type { DecisionSnapshot } from "@/lib/db/runs";
import type { WriteOp } from "@/lib/pipeline/submit";
import type { MetadataOptions } from "@/app/api/metadata/route";
import { effectiveMetadata, metadataDecisionKey, removeAcceptedMetadataValue, type MetadataDecision, type MetadataSettings, type MetadataValues } from "@/lib/metadata/settings";
import type { MetadataReport, MetadataSuggestion } from "@/lib/metadata/types";
import type { WSSolution } from "@/lib/ra/types";
import type { ReferenceChange } from "@/lib/ground-context/server";
import { readNdjson } from "@/lib/ks/stream";
import { MetadataEvidence } from "./MetadataEvidence";
import styles from "./MetadataReview.module.css";

const label = (value: string) => value.replaceAll("//", " › ");
function Multi({ title, values, options, onChange, allowEmpty = true }: { title: string; values: string[]; options: { value: string; label: string }[]; onChange: (values: string[]) => void; allowEmpty?: boolean }) {
  const [query, setQuery] = useState("");
  return <div><label>{title}<input aria-label={`Search ${title}`} placeholder="Search available values" value={query} onChange={e => setQuery(e.target.value)} /></label><div className={styles.chips}>{values.map(value => <button type="button" key={value} disabled={!allowEmpty && values.length === 1} onClick={() => onChange(values.filter(v => v !== value))} aria-label={`Remove ${value}`}>{label(options.find(o => o.value === value)?.label ?? value)} ×</button>)}</div><select aria-label={`Add ${title}`} value="" onChange={e => { if (e.target.value) onChange([...new Set([...values, e.target.value])]); }}><option value="">Choose a value…</option>{options.filter(o => !values.includes(o.value) && o.label.toLowerCase().includes(query.toLowerCase())).slice(0, 100).map(o => <option key={o.value} value={o.value}>{label(o.label)}</option>)}</select></div>;
}
export default function PipelineMetadata({ enabled, runId, connectionId, snapshot, plan, options, value, onChange, onBusy, onReviewReferences }: { enabled: boolean; runId: string; connectionId?: string; snapshot: DecisionSnapshot; plan: WriteOp[]; options: MetadataOptions; value: MetadataSettings; onChange: (value: MetadataSettings) => void; onBusy: (busy: boolean) => void; onReviewReferences: () => void }) {
  const outputs = plan.filter((op): op is Exclude<WriteOp, { kind: "flag" }> => op.kind !== "flag");
  const sourceKey = JSON.stringify({ runId, context: snapshot.groundContextIdentity, outputs: outputs.map(op => ({ ...op, metadata: undefined })) });
  const [research, setResearch] = useState<{ key: string; reports: Record<string, MetadataReport> }>({ key: "", reports: {} });
  const reports = research.key === sourceKey ? research.reports : {};
  const savedReports = useRef(research); useEffect(() => { savedReports.current = research; }, [research]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [referenceFailure, setReferenceFailure] = useState<{ key: string; changes: ReferenceChange[] } | null>(null);
  const [decisionError, setDecisionError] = useState("");
  const [existing, setExisting] = useState<Record<string, WSSolution>>({});
  const [sourceErrors, setSourceErrors] = useState<Record<string, string>>({});
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState("Preparing metadata research…");
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState("");
  const [evidence, setEvidence] = useState<{ report: MetadataReport; suggestion?: MetadataSuggestion } | null>(null);
  const [extraPaths, setExtraPaths] = useState<string[]>([]);
  const [browse, setBrowse] = useState("");
  const [browseError, setBrowseError] = useState("");
  const [children, setChildren] = useState<string[]>([]);
  const [branchFilter, setBranchFilter] = useState("");
  const current = useRef(snapshot); useEffect(() => { current.current = snapshot; }, [snapshot]);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    const work = JSON.parse(sourceKey).outputs as Exclude<WriteOp, { kind: "flag" }>[];
    void Promise.all(work.filter(op => op.kind === "revise").map(async op => {
      try {
        const response = await fetch("/api/metadata-lab/solution?id=" + encodeURIComponent(op.solutionId) + (connectionId ? "&connectionId=" + encodeURIComponent(connectionId) : ""), { signal: controller.signal });
        const data = await response.json();
        if (!response.ok || data.solution?.id !== op.solutionId) throw new Error(data.error ?? "Could not read current article metadata");
        if (!controller.signal.aborted) { setExisting(previous => ({ ...previous, [op.candidateKey]: data.solution })); setSourceErrors(previous => ({ ...previous, [op.candidateKey]: "" })); }
      } catch (error) { if (!controller.signal.aborted) setSourceErrors(previous => ({ ...previous, [op.candidateKey]: error instanceof Error ? error.message : "Could not read current metadata" })); }
    }));
    return () => controller.abort();
  }, [sourceKey, attempt, connectionId]);
  useEffect(() => {
    const controller = new AbortController(); abort.current = controller; let stopped = false;
    void (async () => {
      await Promise.resolve(); if (stopped) return;
      if (!enabled) { setBusy(false); onBusy(false); setStatus("AI research is off. Choose metadata manually below."); return; }
      const completed = savedReports.current.key === sourceKey ? { ...savedReports.current.reports } : {};
      setErrors({}); setReferenceFailure(null); setBusy(true); onBusy(true); let failed = 0, referenceBlocked = false;
      try {
        const work = JSON.parse(sourceKey).outputs as Exclude<WriteOp, { kind: "flag" }>[];
        for (const [index, op] of work.entries()) {
          if (stopped || controller.signal.aborted) break;
          if (completed[op.candidateKey]) continue;
          setStatus(`Article ${index + 1} of ${work.length} · Researching ${op.title}`);
          try {
            const response = await fetch("/api/pipeline-metadata", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ runId, key: op.candidateKey, snapshot: current.current }), signal: controller.signal });
            await readNdjson(response, message => {
              if (stopped) return;
              if (message.type === "progress") setStatus(`${op.title} · ${message.message}`);
              if (message.type === "error" && Array.isArray(message.referenceChanges)) { referenceBlocked = true; setReferenceFailure({ key: sourceKey, changes: message.referenceChanges as ReferenceChange[] }); controller.abort(); }
              if (message.type === "result") { completed[op.candidateKey] = message.report as MetadataReport; setResearch({ key: sourceKey, reports: { ...completed } }); }
            });
          } catch (error) { if (!stopped && !controller.signal.aborted) { failed++; setErrors(previous => ({ ...previous, [op.candidateKey]: error instanceof Error ? error.message : "Research failed" })); } }
        }
      } finally {
        if (!stopped) { setBusy(false); onBusy(false); setStatus(referenceBlocked ? "Research stopped. Review the reference changes below, then analyze again from Content." : controller.signal.aborted ? "Research stopped. Completed suggestions are kept; resume or choose values manually." : failed ? `${failed} article(s) need a research retry. Completed suggestions are ready for review.` : "Research complete. Review each suggestion; nothing is applied automatically."); }
      }
    })();
    return () => { stopped = true; controller.abort(); onBusy(false); };
  }, [enabled, runId, sourceKey, onBusy, attempt]);
  const paths = [...new Set([...options.taxonomies, ...extraPaths, ...Object.values(reports).flatMap(r => r.suggestions.filter(s => s.option.kind === "taxonomy").map(s => s.option.value))])];
  const collections = options.collections.map(c => ({ value: c.code, label: c.label }));
  const fallback = options.collections.find(c => c.code === snapshot.collection || c.label === snapshot.collection)?.code ?? snapshot.collection;
  const selected = outputs.find(op => op.candidateKey === active) ?? outputs[0];
  const report = selected && reports[selected.candidateKey];
  const override = selected && value.solutions?.[selected.candidateKey];
  const original = selected && (existing[selected.candidateKey] ?? report?.solution);
  const shown: MetadataValues = { ...(selected?.kind === "revise" && original ? { collections: original.collections, taxonomies: original.taxonomy, language: original.language } : {}), ...(selected ? effectiveMetadata(value, selected.candidateKey) : {}) };
  const decisions = (key: string) => value.decisions?.[key] ?? {};
  const reviewed = (key: string) => reports[key]?.suggestions.filter(s => decisions(key)[metadataDecisionKey(s.option)]?.researchIdentity === (reports[key].identity ?? reports[key].generatedAt)).length ?? 0;
  const total = Object.values(reports).reduce((n, r) => n + r.suggestions.length, 0);
  const done = outputs.reduce((n, op) => n + reviewed(op.candidateKey), 0);
  function editFields(patch: MetadataValues) { if (selected) onChange({ ...value, solutions: { ...value.solutions, [selected.candidateKey]: { ...override, ...patch } } }); }
  function decide(suggestion: MetadataSuggestion, status: MetadataDecision["status"]) {
    if (!selected || !report) return;
    setDecisionError("");
    const key = metadataDecisionKey(suggestion.option), old = decisions(selected.candidateKey)[key];
    const decision: MetadataDecision = { status, kind: suggestion.option.kind, value: suggestion.option.value, label: suggestion.option.label, attributeName: suggestion.option.attributeName, attributeSet: suggestion.option.attributeSet, sourceEvidence: suggestion.sourceEvidence, researchIdentity: report.identity ?? report.generatedAt };
    let settings = { ...override };
    if (suggestion.option.kind !== "attribute") {
      const field = suggestion.option.kind === "collection" ? "collections" : "taxonomies";
      const existing = shown[field] ?? (field === "collections" ? [fallback].filter(Boolean) : []);
      if (status === "accepted") settings = { ...settings, [field]: [...new Set([...existing, suggestion.option.value])] };
      else if (old?.status === "accepted" && !suggestion.alreadyAssigned) {
        try { settings = { ...settings, [field]: removeAcceptedMetadataValue(field, existing, suggestion.option.value) }; }
        catch (error) { setDecisionError((error as Error).message); return; }
      }
    }
    onChange({ ...value, solutions: { ...value.solutions, [selected.candidateKey]: settings }, decisions: { ...value.decisions, [selected.candidateKey]: { ...decisions(selected.candidateKey), [key]: decision } } });
  }
  function fields(settings: MetadataValues, change: (v: MetadataValues) => void, prefix: string) {
    return <div className={styles.fields}><Multi title={`${prefix} collections`} values={settings.collections ?? [fallback].filter(Boolean)} options={collections} allowEmpty={false} onChange={collections => change({ collections })} /><Multi title={`${prefix} taxonomies`} values={settings.taxonomies ?? []} options={paths.map(value => ({ value, label: value }))} onChange={taxonomies => change({ taxonomies })} /><label>Language<select aria-label={`${prefix} language`} value={settings.language ?? snapshot.language} onChange={e => change({ language: e.target.value })}>{options.languages.map(l => <option key={l}>{l}</option>)}</select></label></div>;
  }
  async function browsePath(path: string) {
    setBrowseError("");
    try { const response = await fetch(`/api/pipeline-metadata?path=${encodeURIComponent(path)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); const values = data.paths.map((p: { value: string }) => p.value); setBrowse(path); setChildren(values); setExtraPaths(previous => [...new Set([...previous, ...values])]); }
    catch (error) { setBrowseError(error instanceof Error ? error.message : "Could not load taxonomy branches"); }
  }
  return <section className={styles.workspace} aria-label="Metadata review workspace">
    {referenceFailure?.key === sourceKey && <section className={styles.warning} role="alert"><h3>Reference knowledge needs review</h3><p>Metadata research stopped because a selected reference changed or became unavailable. Manual metadata choices will not resolve this reference check.</p>{referenceFailure.changes.map(change => <details key={change.id}><summary>{change.title} · #{change.id} · {change.reason}</summary><h4>Saved reference</h4><pre style={{ whiteSpace: "pre-wrap" }}>{change.savedBody}</pre><h4>Current reference</h4><pre style={{ whiteSpace: "pre-wrap" }}>{change.currentBody ?? "Current content is unavailable."}</pre></details>)}<button type="button" onClick={onReviewReferences}>Review references in Content</button></section>}
    {decisionError && <p className={styles.warning} role="alert">{decisionError}</p>}
    <div className={styles.heading}><div><span className={styles.eyebrow}>Classify your articles</span><h3>Review metadata suggestions</h3><p>{outputs.length} articles · {done} of {total} suggestions triaged</p></div><span className={styles.badge}>Your choices control the final values</span></div>
    <div className={styles.status} role="status">{status}<div className={styles.actions}>{busy ? <button type="button" onClick={() => abort.current?.abort()}>Stop research</button> : enabled && <button type="button" onClick={() => setAttempt(n => n + 1)}>Resume / retry unfinished research</button>}</div></div>
    <div className={styles.layout}><nav className={styles.articles} aria-label="Articles to classify">{outputs.map(op => <button key={op.candidateKey} type="button" aria-pressed={selected?.candidateKey === op.candidateKey} onClick={() => setActive(op.candidateKey)}><strong>{op.title}</strong><small>{op.kind === "revise" ? "Revision" : "New article"}{op.mergeSources?.length ? " · Combined sources" : ""}</small><small>{errors[op.candidateKey] ? "Research needs attention" : reports[op.candidateKey] ? `${reviewed(op.candidateKey)}/${reports[op.candidateKey].suggestions.length} decisions recorded` : enabled ? "Awaiting research" : "Manual selection"}</small></button>)}</nav>
      {selected && <div className={styles.panel}><div className={styles.heading}><div><h3>{selected.title}</h3><p>Choose where this article belongs and inspect the evidence behind each suggestion.</p></div>{report && <button type="button" onClick={() => setEvidence({ report })}>View evidence map</button>}</div>
        {errors[selected.candidateKey] && <p className={styles.warning} role="alert">{errors[selected.candidateKey]} You can still choose metadata manually.</p>}
        {!!original?.attributes?.length && <details><summary>Current attributes ? {original.attributeSetName ?? "Existing set"}</summary>{original.attributes.map(a => <p key={a.name}><strong>{a.name}</strong>: {a.values.join(", ")}</p>)}</details>}
        {report && <><p>{report.rationale}</p>{(["collection", "taxonomy", "attribute"] as const).map(kind => <section className={styles.section} key={kind}><h4>{kind === "collection" ? "Destination · Collections" : kind === "taxonomy" ? "Classification · Taxonomy" : "Attribute triage"}</h4>{kind === "attribute" && <p className={styles.warning}>Attribute candidates are observed in similar solutions. Keep, reject or defer them for review. They are saved here but will not be written until the allowed values and attribute set can be verified.</p>}{!report.suggestions.some(s => s.option.kind === kind) && <p>No supported suggestion. {kind === "attribute" ? "No attribute changes will be submitted." : "Choose a value manually if needed."}</p>}{report.suggestions.filter(s => s.option.kind === kind).map(s => {
          const decision = decisions(selected.candidateKey)[metadataDecisionKey(s.option)];
          const fresh = decision?.researchIdentity === (report.identity ?? report.generatedAt);
          const assigned = kind !== "attribute" && (shown[kind === "collection" ? "collections" : "taxonomies"] ?? []).includes(s.option.value);
          return <article className={styles.suggestion} key={s.option.id}><div className={styles.heading}><strong>{label(s.option.label)}</strong><span className={styles.badge}>{fresh ? decision.status === "accepted" ? kind === "attribute" ? "Kept for validation" : assigned ? "Accepted · selected" : "Accepted earlier · value changed" : decision.status : decision ? "Evidence changed · review again" : s.alreadyAssigned ? "Already assigned · review" : "Awaiting decision"}</span></div>{s.option.attributeSet && <p>Attribute set: {s.option.attributeSet}</p>}<p>{s.reason}</p><blockquote>{s.sourceEvidence}</blockquote><div className={styles.actions}><button type="button" aria-pressed={fresh && decision.status === "accepted"} onClick={() => decide(s, "accepted")}>{kind === "attribute" ? "Keep for validation" : "Accept"}</button><button type="button" aria-pressed={fresh && decision.status === "rejected"} onClick={() => decide(s, "rejected")}>Reject</button><button type="button" aria-pressed={fresh && decision.status === "deferred"} onClick={() => decide(s, "deferred")}>Defer</button><button type="button" onClick={() => setEvidence({ report, suggestion: s })}>Why this suggestion?</button></div></article>;
        })}</section>)}{!!report.uncertainties.length && <div className={styles.warning}><strong>Questions to resolve</strong><ul>{report.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul></div>}</>}
        <section className={styles.section}><h4>Values that will be submitted</h4><p>Article choices override shared defaults. Revisions retain existing values when neither is set.</p>{selected.kind !== "revise" || original ? fields(shown, editFields, "Article") : <p role="status">{sourceErrors[selected.candidateKey] ?? "Loading the current article values?"}</p>}<p><small>{(["collections", "taxonomies", "language"] as const).map(field => `${field}: ${override?.[field] !== undefined ? "article override" : value.global?.[field] !== undefined ? "shared default" : selected.kind === "revise" ? "existing article" : "run default"}`).join(" · ")}</small></p>{override && <button type="button" onClick={() => { const solutions = { ...value.solutions }; delete solutions[selected.candidateKey]; onChange({ ...value, solutions }); }}>Reset article overrides</button>}</section>
      </div>}
    </div>
    <details className={styles.defaults}><summary>Shared defaults · {outputs.length} articles</summary><p>Apply only where an article has no explicit override. Review the final values for each article before submitting.</p>{fields(value.global ?? {}, patch => onChange({ ...value, global: { ...value.global, ...patch } }), "Shared")}</details>
    <details className={styles.defaults}><summary>Browse taxonomy catalog</summary><div className={styles.actions}><button type="button" onClick={() => void browsePath("")}>Browse root</button>{browse && <button type="button" onClick={() => void browsePath(browse.split("//").slice(0, -1).join("//"))}>Parent branch</button>}</div><p>{label(browse)}</p><div className={styles.fields}><label>Filter branches<input value={branchFilter} onChange={e => setBranchFilter(e.target.value)} /></label></div><div className={styles.actions}>{children.filter(p => p.toLowerCase().includes(branchFilter.toLowerCase())).slice(0, 100).map(path => <button key={path} type="button" onClick={() => void browsePath(path)}>{label(path)} →</button>)}</div>{browseError && <p role="alert">{browseError}</p>}</details>
    {evidence && <MetadataEvidence {...evidence} onClose={() => setEvidence(null)} />}
  </section>;
}
