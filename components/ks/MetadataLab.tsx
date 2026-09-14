"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { WSSolution } from "@/lib/ra/types";
import type { MetadataReport } from "@/lib/metadata/types";

type Row = { id: string; title: string; summary: string; status: string };
const pathLabel = (s: string) => s.replaceAll("//", " › ");
function Values({ values }: { values?: string[] }) {
  return values?.length ? <ul className="ml-values">{values.map((v, i) => <li key={`${i}:${v}`}>{pathLabel(v)}</li>)}</ul> : <p className="ml-muted">None assigned</p>;
}
async function getJson(url: string, signal?: AbortSignal) {
  const response = await fetch(url, { signal, cache: "no-store" });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
export default function MetadataLab() {
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"search" | "id">("search");
  const [rows, setRows] = useState<Row[]>([]);
  const [searched, setSearched] = useState(false);
  const [solution, setSolution] = useState<WSSolution | null>(null);
  const [collectionLabels, setCollectionLabels] = useState<Record<string, string>>({});
  const collectionNames = (codes?: string[]) => codes?.map(c => collectionLabels[c] && collectionLabels[c] !== c ? `${collectionLabels[c]} (${c})` : c);
  const [report, setReport] = useState<MetadataReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [lastQuery, setLastQuery] = useState("");
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function load(id: string) {
    setBusy(true); setError(""); setReport(null); setSolution(null); setProgress([]);
    try { const data = await getJson(`/api/metadata-lab/solution?id=${encodeURIComponent(id)}`); setSolution(data.solution); setCollectionLabels(data.collectionLabels ?? {}); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load solution"); }
    finally { setBusy(false); }
  }
  async function search(nextPage = 1, text = query) {
    if (!text.trim() || busy || running) return;
    if (mode === "id") { await load(text.trim()); return; }
    setBusy(true); setError(""); setRows([]); setSearched(false); setSolution(null); setReport(null); setProgress([]);
    try {
      const data = await getJson(`/api/metadata-lab/solution?q=${encodeURIComponent(text.trim())}&page=${nextPage}`);
      setRows(data.rows); setTotal(data.totalHits); setPage(nextPage); setLastQuery(text); setSearched(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Search failed"); }
    finally { setBusy(false); }
  }
  async function analyze() {
    if (!solution || running) return;
    const abort = new AbortController(); active.current = abort;
    setRunning(true); setReport(null); setError(""); setProgress([]);
    let completed = false;
    try {
      const response = await fetch("/api/metadata-lab/analyze", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ solutionId: solution.id }), signal: abort.signal });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error ?? "Analysis failed"); }
      if (!response.body) throw new Error("Analysis did not return a response");
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let buffer = "";
      const receive = (line: string) => {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === "error") throw new Error(event.message);
        if (event.type === "progress") setProgress(p => [...p, event.message]);
        if (event.type === "result") { completed = true; setReport(event.report); setSolution(event.report.solution); setCollectionLabels(event.report.collectionLabels ?? {}); }
      };
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; lines.forEach(receive);
      }
      buffer += decoder.decode(); receive(buffer);
      if (!completed) throw new Error("The analysis connection ended before completion. Please try again.");
    } catch (e) { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "Analysis failed"); }
    finally { setRunning(false); active.current = null; }
  }
  function download() {
    if (!report) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = `metadata-${report.solution.id}.json`; a.click(); URL.revokeObjectURL(url);
  }
  return <div className="ml-page">
    <header className="ml-header"><Link href="/">Knowledge Studio</Link><span>Metadata lab</span><Link className="ds-btn ds-btn-secondary" href="/">Back to studio</Link></header>
    <main className="ml-main">
      <h1>Validate metadata suggestions</h1>
      <p className="ml-intro">Find a solution, research its context, and compare AI suggestions with its current metadata. Your solution stays unchanged.</p>
      <section className="ml-card" aria-labelledby="find-solution">
        <h2 id="find-solution">1. Find a solution</h2>
        <form onSubmit={e => { e.preventDefault(); void search(); }} className="ml-search">
          <label>Find by<select value={mode} disabled={busy || running} onChange={e => { setMode(e.target.value as "search" | "id"); setRows([]); setSearched(false); }}><option value="search">Search terms</option><option value="id">Solution ID</option></select></label>
          <label className="ml-grow">{mode === "id" ? "Solution ID" : "Search terms"}<input value={query} maxLength={300} disabled={busy || running} onChange={e => setQuery(e.target.value)} placeholder={mode === "id" ? "Enter the solution ID" : "For example: RightAnswers password reset"} /></label>
          <button className="ds-btn ds-btn-primary" disabled={busy || running || !query.trim()}>{busy ? "Loading…" : mode === "id" ? "Load solution" : "Search"}</button>
        </form>
        {searched && <p className="ml-muted">{total.toLocaleString()} results · Page {page}{rows.length === 0 ? " · No solutions found. Try different terms." : ""}</p>}
        <div className="ml-results">{rows.map(row => <button key={row.id} className={`ml-result ${solution?.id === row.id ? "ml-selected" : ""}`} disabled={busy || running} onClick={() => void load(row.id)}><strong>{row.title}</strong><span>{row.id} · {row.status}</span>{row.summary && <span>{row.summary}</span>}</button>)}</div>
        {searched && <div className="ml-actions"><button className="ds-btn ds-btn-secondary" disabled={busy || running || page === 1} onClick={() => void search(page - 1, lastQuery)}>Previous</button><button className="ds-btn ds-btn-secondary" disabled={busy || running || !rows.length || page >= 100} onClick={() => void search(page + 1, lastQuery)}>Next page</button></div>}
      </section>
      {error && <div role="alert" className="ml-error">{error}</div>}
      {solution && <section className="ml-card" aria-labelledby="selected-solution">
        <h2 id="selected-solution">2. Research this solution</h2><h3>{solution.title}</h3><p className="ml-muted">{solution.id} · {solution.status} · {solution.language}</p>
        <details><summary>Read solution content</summary><p className="ml-content">{solution.summary}</p>{solution.fields?.map((f, i) => <div key={i}><h4>{f.name}</h4><p className="ml-content">{f.content}</p></div>)}</details>
        <div className="ml-columns"><div><h3>Current collections</h3><Values values={collectionNames(solution.collections)} /></div><div><h3>Current taxonomies</h3><Values values={solution.taxonomy} /></div></div>
        {!!solution.attributes?.length && <details><summary>Current attributes{solution.attributeSetName ? ` · ${solution.attributeSetName}` : ""}</summary>{solution.attributes.map((a, i) => <div key={i}><h4>{a.name} ({a.values.length})</h4><Values values={a.values.slice(0, 30)} />{a.values.length > 30 && <p>Showing the first 30 values.</p>}</div>)}</details>}
        <div className="ml-actions"><button className="ds-btn ds-btn-primary" disabled={running || busy} onClick={() => void analyze()}>{running ? "Researching…" : report ? "Run again" : "Research metadata"}</button>{running && <button className="ds-btn ds-btn-secondary" onClick={() => { active.current?.abort(); setProgress(p => [...p, "Analysis cancelled."]); }}>Cancel</button>}</div>
        {!!progress.length && <div role="status" aria-live="polite" className="ml-progress">{running ? progress.at(-1) : report ? "Research complete" : progress.at(-1)}<details><summary>Research steps</summary><ol>{progress.map((p, i) => <li key={i}>{p}</li>)}</ol></details></div>}
      </section>}
      {report && <section className="ml-card" aria-labelledby="suggestions"><div className="ml-actions"><h2 id="suggestions">3. Suggested metadata</h2><button className="ds-btn ds-btn-secondary" onClick={download}>Export research</button></div><p>{report.rationale}</p>
        {(["collection", "taxonomy", "attribute"] as const).map(kind => <div key={kind}><h3>{kind === "collection" ? "Collections" : kind === "taxonomy" ? "Taxonomies" : "Attributes"}</h3>{!report.suggestions.some(s => s.option.kind === kind) && <p className="ml-muted">No supported suggestion for this field.</p>}{report.suggestions.filter(s => s.option.kind === kind).map(s => <article key={s.option.id} className="ml-suggestion"><div className="ml-actions"><strong>{pathLabel(s.option.label)}</strong><span className="ml-badge">{s.alreadyAssigned ? "Already assigned" : "Suggested addition"}</span>{s.option.origin === "observed" && <span className="ml-badge">Observed in examples · unverified</span>}</div><p>{s.reason}</p><blockquote>{s.sourceEvidence}</blockquote>{s.exampleIds.length > 0 && <p>Supporting solutions: {s.exampleIds.map(id => <a key={id} href={`#example-${id}`}>{id} </a>)}</p>}</article>)}</div>)}
        <p className="ml-muted">Existing values not suggested here are not automatically considered incorrect. Nothing has been applied.</p>
        {!!report.uncertainties.length && <><h3>Needs your judgment</h3><ul>{report.uncertainties.map((u, i) => <li key={i}>{u}</li>)}</ul></>}
        <details open><summary>Research coverage and limitations</summary><p>{report.coverage.examples} published examples · {report.coverage.collections} collections available · {report.coverage.taxonomyPaths} taxonomy paths discovered · {report.coverage.candidates} candidates evaluated</p><ul>{report.limitations.map((l, i) => <li key={i}>{l}</li>)}</ul><p>Search queries: {report.queries.join(" / ")}</p><p>Branches inspected: {report.coverage.browsedPaths.map(pathLabel).join("; ") || "None"}</p></details>
        <h3>Similar solutions considered</h3><p className="ml-muted">These are comparison examples, not automatically endorsements of their metadata.</p>{report.examples.map(e => <details id={`example-${e.id}`} key={e.id}><summary>{e.title} · {e.id}</summary><p>{e.summary}</p><h4>Collections</h4><Values values={collectionNames(e.collections)} /><h4>Taxonomies</h4><Values values={e.taxonomy} /></details>)}
      </section>}
    </main>
  </div>;
}
