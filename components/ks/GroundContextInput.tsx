"use client";

import { useEffect, useRef, useState } from "react";
import type { GroundContextInput as Selection, GroundReference } from "@/lib/ground-context/types";
import type { KbSearchRow } from "@/app/api/kb/search/route";
import styles from "./GroundContext.module.css";

export function GroundContextInput({ value, onChange, excludedIds, savedReferences = [] }: {
  value: Selection;
  onChange: (value: Selection) => void;
  excludedIds: string[];
  savedReferences?: GroundReference[];
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<KbSearchRow[]>([]);
  const [known, setKnown] = useState<Record<string, KbSearchRow>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<GroundReference | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const previewRequest = useRef<AbortController | null>(null);
  useEffect(() => () => previewRequest.current?.abort(), []);
  useEffect(() => {
    if (!value.enabled || !query.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true); setError("");
      try {
        const response = await fetch("/api/kb/search?q=" + encodeURIComponent(query.trim()), { signal: controller.signal });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Could not search the knowledge base.");
        if (!controller.signal.aborted) {
          setRows(result.rows);
          setKnown(current => ({ ...current, ...Object.fromEntries(result.rows.map((row: KbSearchRow) => [row.id, row])) }));
        }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Search failed."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }, 350);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query, value.enabled]);

  async function openReference(id: string) {
    previewRequest.current?.abort();
    const controller = new AbortController();
    previewRequest.current = controller;
    setPreview(null); setPreviewBusy(true); setError("");
    try {
      const response = await fetch("/api/kb/reference?id=" + encodeURIComponent(id), { signal: controller.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not read this reference.");
      if (!controller.signal.aborted) setPreview(result.reference);
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not read this reference."); }
    finally { if (!controller.signal.aborted) setPreviewBusy(false); }
  }
  function toggle(id: string) {
    onChange({ ...value, referenceSolutionIds: value.referenceSolutionIds.includes(id) ? value.referenceSolutionIds.filter(item => item !== id) : [...value.referenceSolutionIds, id] });
  }
  return <section className={styles.card} aria-label="Ground Context">
    <div className={styles.cardHeading}>
      <span className={styles.contextIcon}><span className="ms" aria-hidden="true">library_books</span></span>
      <div className={styles.cardTitle}><h2>Ground Context</h2><p>Use selected KB solutions as reference evidence when creating or enriching content.</p></div>
      <label className={styles.enabled}><input type="checkbox" checked={value.enabled} onChange={event => { setLoading(false); onChange({ ...value, enabled: event.target.checked }); }} />Enable Ground Context</label>
    </div>
    {!value.enabled && value.referenceSolutionIds.length > 0 && <p className={styles.footnote}>{value.referenceSolutionIds.length} references kept. Enable Ground Context to use them.</p>}
    {value.enabled && <div style={{ marginTop: 18 }}>
      <label className={styles.label} htmlFor="live-reference-search">Search reference solutions</label>
      <div className={styles.searchBox}><span className="ms" aria-hidden="true">search</span><input id="live-reference-search" type="search" maxLength={500} value={query} placeholder="Search your knowledge base" onChange={event => { setQuery(event.target.value); setRows([]); setError(""); setLoading(!!event.target.value.trim()); }} /></div>
      <p className={styles.footnote}>Select up to 8 published solutions. References remain unchanged and cannot be processing targets.</p>
      <div className={styles.selectionChips} style={{ marginTop: 12 }} aria-label="Selected Ground Context references">{value.referenceSolutionIds.map(id => <button type="button" key={id} onClick={() => toggle(id)} aria-label={"Remove reference " + id}>{known[id]?.title ?? savedReferences.find(reference => reference.id === id)?.title ?? id}<span className="ms" aria-hidden="true">close</span></button>)}</div>
      {error && <p role="alert" className={styles.warning}>{error}</p>}
      {loading && <p role="status">Searching solutions…</p>}
      {query.trim() && !loading && !error && !rows.length && <p role="status">No matching solutions. Try another search.</p>}
      <div className={styles.results}>{rows.map(row => {
        const selected = value.referenceSolutionIds.includes(row.id);
        const reason = excludedIds.includes(row.id) ? "Already selected as a processing target" : row.status && !["published", "approved"].includes(row.status.toLowerCase()) ? "Published references only" : !selected && value.referenceSolutionIds.length >= 8 ? "8-reference limit reached" : "";
        return <div className={styles.result} key={row.id}>
          <label className={styles.resultSelection}><input type="checkbox" checked={selected} disabled={!!reason && !selected} onChange={() => toggle(row.id)} /><span><strong>{row.title}</strong><small>{row.id} · {row.meta}{reason ? " · " + reason : ""}</small></span></label>
          <button type="button" className={styles.textButton} onClick={() => openReference(row.id)}>Preview reference</button>
        </div>;
      })}</div>
      {previewBusy && <p role="status">Reading reference…</p>}
      {preview && <section className={styles.preview} aria-label="Ground Context reference preview" style={{ marginTop: 16, borderLeft: 0 }}><h3>{preview.title}</h3><span className={styles.referenceBadge}>Reference only</span><p>{preview.id} · {preview.status}{preview.updated ? " · Updated " + preview.updated : ""}</p><p style={{ whiteSpace: "pre-wrap" }}>{preview.body}</p><button type="button" className={styles.secondary} onClick={() => setPreview(null)}>Close preview</button></section>}
      <div className={styles.guidance} style={{ paddingInline: 0, marginTop: 16 }}><label className={styles.label} htmlFor="live-reference-guidance">How should AI use these references? <span>Optional</span></label><textarea id="live-reference-guidance" rows={2} maxLength={1000} value={value.guidance} onChange={event => onChange({ ...value, guidance: event.target.value })} placeholder="For example: apply these regulatory requirements to commercial insurance claims." /></div>
    </div>}
  </section>;
}