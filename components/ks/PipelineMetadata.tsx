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
const decisionTabs = ["collection", "taxonomy", "attribute", "questions"] as const;
type DecisionTab = typeof decisionTabs[number];
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
  const [manualField, setManualField] = useState<"collections" | "taxonomies" | "language" | null>(null);
  const [activeTab, setActiveTab] = useState<DecisionTab>("collection");
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
  const articleState = (op: Exclude<WriteOp, { kind: "flag" }>) => {
    const itemReport = reports[op.candidateKey];
    if (errors[op.candidateKey]) return { tone: "attention", label: "Research unavailable", detail: "Classify manually or retry" };
    if (!itemReport) return enabled ? { tone: "working", label: busy ? "Researching" : "Awaiting research", detail: "Suggestions will appear here" } : { tone: "manual", label: "Manual classification", detail: "Choose values directly" };
    const count = reviewed(op.candidateKey);
    if (itemReport.suggestions.length && count < itemReport.suggestions.length) return { tone: "review", label: "Needs decisions", detail: `${itemReport.suggestions.length - count} suggestion${itemReport.suggestions.length - count === 1 ? "" : "s"} to review` };
    return { tone: "ready", label: "Ready to submit", detail: itemReport.suggestions.length ? "All suggestions reviewed" : "No supported suggestions" };
  };
  const needsAttention = outputs.filter(op => ["attention", "review"].includes(articleState(op).tone)).length;
  const researching = outputs.filter(op => ["working"].includes(articleState(op).tone)).length;
  const nextAction = outputs.find(op => ["attention", "review"].includes(articleState(op).tone));
  const valuesFor = (op: Exclude<WriteOp, { kind: "flag" }>): MetadataValues => ({ ...(op.kind === "revise" && existing[op.candidateKey] ? { collections: existing[op.candidateKey].collections, taxonomies: existing[op.candidateKey].taxonomy, language: existing[op.candidateKey].language } : {}), ...effectiveMetadata(value, op.candidateKey) });
  const tabStatus = (tab: DecisionTab) => {
    if (tab === "questions") return report?.uncertainties.length ? `${report.uncertainties.length} question${report.uncertainties.length === 1 ? "" : "s"}` : "None";
    const suggestions = report?.suggestions.filter(s => s.option.kind === tab) ?? [];
    const pending = suggestions.filter(s => !decisions(selected?.candidateKey ?? "")[metadataDecisionKey(s.option)]).length;
    return !suggestions.length ? "No suggestion" : pending ? `${pending} to review` : "Reviewed";
  };
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
  function fields(settings: MetadataValues, change: (v: MetadataValues) => void, prefix: string, only?: "collections" | "taxonomies" | "language") {
    return <div className={styles.fields}>{(!only || only === "collections") && <Multi title={`${prefix} collections`} values={settings.collections ?? [fallback].filter(Boolean)} options={collections} allowEmpty={false} onChange={collections => change({ collections })} />}{(!only || only === "taxonomies") && <Multi title={`${prefix} taxonomies`} values={settings.taxonomies ?? []} options={paths.map(value => ({ value, label: value }))} onChange={taxonomies => change({ taxonomies })} />}{(!only || only === "language") && <label>Language<select aria-label={`${prefix} language`} value={settings.language ?? snapshot.language} onChange={e => change({ language: e.target.value })}>{options.languages.map(l => <option key={l}>{l}</option>)}</select></label>}</div>;
  }
  async function browsePath(path: string) {
    setBrowseError("");
    try { const response = await fetch(`/api/pipeline-metadata?path=${encodeURIComponent(path)}${connectionId ? `&connectionId=${encodeURIComponent(connectionId)}` : ""}`); const data = await response.json(); if (!response.ok) throw new Error(data.error); const values = data.paths.map((p: { value: string }) => p.value); setBrowse(path); setChildren(values); setExtraPaths(previous => [...new Set([...previous, ...values])]); }
    catch (error) { setBrowseError(error instanceof Error ? error.message : "Could not load taxonomy branches"); }
  }
  return <section className={styles.workspace} aria-label="Metadata review workspace">
    {referenceFailure?.key === sourceKey && <section className={styles.warning} role="alert"><h3>Reference knowledge needs review</h3><p>Metadata research stopped because a selected reference changed or became unavailable. Manual metadata choices will not resolve this reference check.</p>{referenceFailure.changes.map(change => <details key={change.id}><summary>{change.title} · #{change.id} · {change.reason}</summary><h4>Saved reference</h4><pre style={{ whiteSpace: "pre-wrap" }}>{change.savedBody}</pre><h4>Current reference</h4><pre style={{ whiteSpace: "pre-wrap" }}>{change.currentBody ?? "Current content is unavailable."}</pre></details>)}<button type="button" onClick={onReviewReferences}>Review references in Content</button></section>}
    {decisionError && <p className={styles.warning} role="alert">{decisionError}</p>}
    <div className={styles.heading}><div><span className={styles.eyebrow}>Step 3 · Classify articles</span><h3>Choose metadata with confidence</h3><p>{outputs.length} article{outputs.length === 1 ? "" : "s"} · {needsAttention ? `${needsAttention} need${needsAttention === 1 ? "s" : ""} your attention` : researching ? `researching ${researching} article${researching === 1 ? "" : "s"}` : "all ready to review"}</p></div><div className={styles.headerActions}>{nextAction && nextAction.candidateKey !== selected?.candidateKey && <button type="button" onClick={() => setActive(nextAction.candidateKey)}>Review next article</button>}<span className={styles.badge}>You control every final value</span></div></div>
    <div className={styles.status} role="status"><span>{status}</span><div className={styles.actions}>{busy ? <button type="button" onClick={() => abort.current?.abort()}>Stop research</button> : enabled && <button type="button" onClick={() => setAttempt(n => n + 1)}>Retry incomplete research</button>}</div></div>
    <div className={styles.classifyLayout}><nav className={styles.articles} aria-label="Articles to classify">{outputs.map(op => { const state = articleState(op); return <button key={op.candidateKey} className={styles.articleButton} type="button" aria-pressed={selected?.candidateKey === op.candidateKey} onClick={() => { setActive(op.candidateKey); setManualField(null); setActiveTab("collection"); }}><strong>{op.title}</strong><small>{op.kind === "revise" ? "Revision" : "New article"}{op.mergeSources?.length ? " · Combined sources" : ""}</small><span className={`${styles.articleState} ${styles[`state${state.tone[0].toUpperCase()}${state.tone.slice(1)}`]}`}>{state.label}</span><small>{state.detail}</small></button>; })}</nav>
      {selected && <div className={styles.panel}><div className={styles.panelTitle}><div><span className={styles.eyebrow}>Article decision</span><h3>{selected.title}</h3><p>Review supported recommendations or choose the values yourself.</p></div>{report && <button type="button" onClick={() => setEvidence({ report })}>View all evidence</button>}</div>
        {errors[selected.candidateKey] && <section className={styles.failure} role="alert"><strong>Suggestions could not be generated</strong><p>Nothing was changed. Retry research, or classify this article manually below.</p><div className={styles.actions}><button type="button" onClick={() => setAttempt(n => n + 1)}>Retry research</button><button type="button" onClick={() => setManualField("collections")}>Classify manually</button></div><details><summary>Technical details</summary><pre>{errors[selected.candidateKey]}</pre></details></section>}
        {report && <><section className={styles.assessment}><span className={styles.eyebrow}>AI assessment</span><p>{report.rationale}</p></section><div className={styles.decisionTabs} role="tablist" aria-label="Metadata decisions">{decisionTabs.map(tab => <button key={tab} id={`metadata-tab-${tab}`} type="button" role="tab" aria-selected={activeTab === tab} aria-controls={`metadata-panel-${tab}`} onClick={() => setActiveTab(tab)}><span>{tab === "collection" ? "Collection" : tab === "taxonomy" ? "Taxonomy" : tab === "attribute" ? "Attributes" : "Questions"}</span><small>{tabStatus(tab)}</small></button>)}</div>{(["collection", "taxonomy", "attribute"] as const).filter(kind => activeTab === kind).map(kind => <section className={styles.section} key={kind} id={`metadata-panel-${kind}`} role="tabpanel" aria-labelledby={`metadata-tab-${kind}`}><div className={styles.sectionHeading}><div><h4>{kind === "collection" ? "Collection" : kind === "taxonomy" ? "Taxonomy" : "Attributes"}</h4><p>{kind === "collection" ? "Where this article belongs." : kind === "taxonomy" ? "How people will find it." : "Observed values require administrative validation."}</p></div></div>{!report.suggestions.some(s => s.option.kind === kind) && <div className={styles.emptyDecision}><strong>No supported recommendation</strong><p>{kind === "attribute" ? "No attribute changes will be submitted." : "Choose a value if you know the correct classification."}</p>{kind !== "attribute" && <button type="button" onClick={() => setManualField(kind === "collection" ? "collections" : "taxonomies")}>Choose a value</button>}</div>}{report.suggestions.filter(s => s.option.kind === kind).map(s => {
          const decision = decisions(selected.candidateKey)[metadataDecisionKey(s.option)];
          const fresh = decision?.researchIdentity === (report.identity ?? report.generatedAt);
          const assigned = kind !== "attribute" && (shown[kind === "collection" ? "collections" : "taxonomies"] ?? []).includes(s.option.value);
          const state = fresh ? decision?.status : undefined;
          return <article className={styles.decisionCard} key={s.option.id}><div className={styles.decisionTop}><div><span className={styles.eyebrow}>Recommended {kind}</span><strong>{label(s.option.label)}</strong></div><span className={styles.badge}>{state === "accepted" ? (kind === "attribute" ? "Kept for validation" : assigned ? "Accepted" : "Value changed") : state === "rejected" ? "Not applicable" : state === "deferred" ? "Needs expert review" : "Your decision needed"}</span></div>{s.option.attributeSet && <small>Attribute set: {s.option.attributeSet}</small>}<p>{s.reason}</p><blockquote><span>Evidence from this article</span>{s.sourceEvidence}</blockquote><div className={styles.actions}><button type="button" aria-pressed={state === "accepted"} onClick={() => decide(s, "accepted")}>{kind === "attribute" ? "Keep for validation" : "Accept"}</button>{kind !== "attribute" && <button type="button" onClick={() => setManualField(kind === "collection" ? "collections" : "taxonomies")}>Choose another</button>}<button type="button" aria-pressed={state === "rejected"} onClick={() => decide(s, "rejected")}>Not applicable</button><button type="button" aria-pressed={state === "deferred"} onClick={() => decide(s, "deferred")}>Needs expert review</button><button type="button" onClick={() => setEvidence({ report, suggestion: s })}>Why this?</button></div></article>;
        })}</section>)}{activeTab === "questions" && <section className={styles.questions} id="metadata-panel-questions" role="tabpanel" aria-labelledby="metadata-tab-questions"><strong>{report.uncertainties.length ? "Questions that need your judgment" : "No questions need your judgment"}</strong>{report.uncertainties.length ? <ul>{report.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul> : <p>The available evidence supports the current recommendations without an unresolved question.</p>}</section>}</>}
        {!!original?.attributes?.length && <details className={styles.advanced}><summary>Current attributes · {original.attributeSetName ?? "Existing set"}</summary>{original.attributes.map(a => <p key={a.name}><strong>{a.name}</strong>: {a.values.join(", ")}</p>)}</details>}
        <details className={styles.manual} open={!!manualField} onToggle={event => { if (!event.currentTarget.open) setManualField(null); }}><summary>Choose metadata manually</summary><p>Use this when the recommendation is incomplete or you know a better value.</p>{selected.kind !== "revise" || original ? fields(shown, editFields, "Article", manualField ?? undefined) : <p role="status">{sourceErrors[selected.candidateKey] ?? "Loading current article values…"}</p>}</details>
        {override && <button className={styles.reset} type="button" onClick={() => { const solutions = { ...value.solutions }; delete solutions[selected.candidateKey]; onChange({ ...value, solutions }); }}>Reset this article to inherited values</button>}
      </div>}
      {selected && <aside className={styles.finalValues} aria-label="Final metadata values"><div><span className={styles.eyebrow}>Final values</span><h3>What will be submitted</h3><p>These are the effective values for this article.</p></div><dl><div><dt>Collections</dt><dd>{(shown.collections ?? [fallback].filter(Boolean)).map(collection => label(collections.find(c => c.value === collection)?.label ?? collection)).join(", ") || "None"}</dd></div><div><dt>Taxonomy</dt><dd>{(shown.taxonomies ?? []).map(label).join("; ") || "None"}</dd></div><div><dt>Language</dt><dd>{shown.language ?? snapshot.language}</dd></div></dl><div className={styles.valueSources}>{(["collections", "taxonomies", "language"] as const).map(field => <p key={field}><strong>{field}</strong>: {override?.[field] !== undefined ? "article choice" : value.global?.[field] !== undefined ? "shared default" : selected.kind === "revise" ? "existing article" : "run default"}</p>)}</div><details><summary>How precedence works</summary><p>Article choices win. If you leave a revision unchanged, its existing values are kept. Shared defaults fill only fields without an article-specific value.</p></details></aside>}
    </div>
    <details className={styles.confirmation}><summary>Confirm final metadata for all {outputs.length} article{outputs.length === 1 ? "" : "s"}</summary><p>Review the effective values before you continue. You can return to any article to change a value.</p><div className={styles.confirmationList}>{outputs.map(op => { const item = valuesFor(op); return <section key={op.candidateKey}><div><strong>{op.title}</strong><span className={`${styles.articleState} ${styles[`state${articleState(op).tone[0].toUpperCase()}${articleState(op).tone.slice(1)}`]}`}>{articleState(op).label}</span></div><dl><div><dt>Collections</dt><dd>{(item.collections ?? [fallback].filter(Boolean)).map(collection => label(collections.find(c => c.value === collection)?.label ?? collection)).join(", ") || "None"}</dd></div><div><dt>Taxonomy</dt><dd>{(item.taxonomies ?? []).map(label).join("; ") || "None"}</dd></div><div><dt>Language</dt><dd>{item.language ?? snapshot.language}</dd></div></dl><button type="button" onClick={() => setActive(op.candidateKey)}>Review article</button></section>; })}</div></details>
    <details className={styles.defaults}><summary>Apply shared defaults to multiple articles</summary><p>Shared defaults fill only fields without an article-specific choice. They never replace a value you choose above.</p>{fields(value.global ?? {}, patch => onChange({ ...value, global: { ...value.global, ...patch } }), "Shared")}</details>
    <details className={styles.defaults}><summary>Browse taxonomy catalog</summary><div className={styles.actions}><button type="button" onClick={() => void browsePath("")}>Browse root</button>{browse && <button type="button" onClick={() => void browsePath(browse.split("//").slice(0, -1).join("//"))}>Parent branch</button>}</div><p>{label(browse)}</p><div className={styles.fields}><label>Filter branches<input value={branchFilter} onChange={e => setBranchFilter(e.target.value)} /></label></div><div className={styles.actions}>{children.filter(p => p.toLowerCase().includes(branchFilter.toLowerCase())).slice(0, 100).map(path => <button key={path} type="button" onClick={() => void browsePath(path)}>{label(path)} →</button>)}</div>{browseError && <p role="alert">{browseError}</p>}</details>
    {evidence && <MetadataEvidence {...evidence} onClose={() => setEvidence(null)} />}
  </section>;
}
