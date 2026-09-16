"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  groundContextReferences,
  selectedGroundReferences,
  type GroundContextSelection,
} from "@/lib/ks/ground-context-demo";
import styles from "./GroundContext.module.css";

function Icon({ name }: { name: string }) {
  return <span className="ms" aria-hidden="true">{name}</span>;
}

interface CardProps {
  value: GroundContextSelection;
  onChange: (value: GroundContextSelection) => void;
  onOpen: () => void;
}

export function GroundContextCard({ value, onChange, onOpen }: CardProps) {
  const references = selectedGroundReferences(value);
  return (
    <section className={styles.card} aria-label="Ground Context references">
      <div className={styles.cardHeading}>
        <span className={styles.contextIcon}><Icon name="library_books" /></span>
        <div className={styles.cardTitle}>
          <h2>Ground Context {references.length > 0 && <span className={styles.count}>{references.length} reference{references.length === 1 ? "" : "s"}</span>}</h2>
          <p>{references.length ? "Reference material for creating and enriching this solution." : "Give AI reference material from your knowledge base."}</p>
        </div>
        {references.length > 0 && <label className={styles.enabled}><input type="checkbox" checked={value.enabled} onChange={event => onChange({ ...value, enabled: event.target.checked })} />Use references</label>}
        <button type="button" className={styles.secondary} onClick={onOpen}><Icon name={references.length ? "tune" : "add"} />{references.length ? "Manage references" : "Select references"}</button>
      </div>
      {references.length > 0 && <>
        <div className={styles.selectedReferences}>
          {references.map(reference => <div className={styles.selectedReference} key={reference.id}>
            <Icon name="description" /><div><strong>{reference.title}</strong><small>{reference.id} · Reference only</small></div>
            <button type="button" className={styles.iconButton} aria-label={"Remove reference " + reference.title} onClick={() => {
              const referenceIds = value.referenceIds.filter(id => id !== reference.id);
              onChange({ ...value, referenceIds, enabled: referenceIds.length > 0 && value.enabled });
            }}><Icon name="close" /></button>
          </div>)}
        </div>
        {value.guidance && <p className={styles.guidanceSummary}><strong>Guidance:</strong> {value.guidance}</p>}
        <p className={styles.footnote}>{value.enabled ? "Reference only: these articles provide evidence and remain unchanged." : "Ground Context is off. Your selections are kept for later."}</p>
      </>}
    </section>
  );
}

interface PickerProps {
  value: GroundContextSelection;
  onSave: (value: GroundContextSelection) => void;
  onCancel: () => void;
}

export function GroundContextPicker({ value, onSave, onCancel }: PickerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [ids, setIds] = useState(value.referenceIds);
  const [guidance, setGuidance] = useState(value.guidance);
  const [previewId, setPreviewId] = useState(value.referenceIds[0] ?? groundContextReferences[0].id);

  useEffect(() => {
    const element = dialog.current!;
    element.showModal();
    search.current?.focus();
    return () => element.close();
  }, []);

  const words = query.toLowerCase().trim().split(/s+/).filter(Boolean);
  const results = groundContextReferences.filter(reference => {
    const text = [reference.id, reference.title, reference.collection, reference.summary, reference.body].join(" ").toLowerCase();
    return words.every(word => text.includes(word));
  });
  const preview = groundContextReferences.find(reference => reference.id === previewId);
  function toggle(id: string) {
    setIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  }

  return createPortal(
    <dialog ref={dialog} className={styles.dialog} aria-labelledby="ground-context-title" aria-describedby="ground-context-description" onCancel={event => { event.preventDefault(); onCancel(); }}>
      <header className={styles.dialogHeader}>
        <div><span className={styles.eyebrow}>REFERENCE KNOWLEDGE</span><h2 id="ground-context-title">Ground Context</h2><p id="ground-context-description">Select solutions AI can use as evidence when creating or enriching your content.</p></div>
        <button type="button" className={styles.iconButton} onClick={onCancel} aria-label="Close Ground Context"><Icon name="close" /></button>
      </header>
      <div className={styles.demoNotice}><Icon name="science" /><span>Demo knowledge base · Fictional articles for this interactive preview.</span></div>
      <div className={styles.pickerBody}>
        <div className={styles.searchColumn}>
          <label className={styles.label} htmlFor="ground-search">Search solutions</label>
          <div className={styles.searchBox}><Icon name="search" /><input ref={search} id="ground-search" type="search" placeholder="Search by keyword, title, or solution ID" value={query} onChange={event => setQuery(event.target.value)} /></div>
          <div className={styles.resultsCount} role="status">{results.length} matching solution{results.length === 1 ? "" : "s"} · {ids.length} selected</div>
          {ids.length > 0 && <div className={styles.selectionChips} aria-label="Selected references">{ids.map(id => <button type="button" key={id} aria-label={"Deselect " + id} onClick={() => toggle(id)}>{id}<Icon name="close" /></button>)}</div>}
          <div className={styles.results} aria-label="Matching solutions">
            {!results.length && <div className={styles.empty}><Icon name="search_off" /><strong>No matching solutions</strong><p>Try “VPN”, “authentication”, or “security”. Your selected references are kept.</p><button type="button" className={styles.secondary} onClick={() => setQuery("")}>Clear search</button></div>}
            {results.map(reference => <article key={reference.id} className={styles.result} data-selected={ids.includes(reference.id)}>
              <label className={styles.resultSelection}>
                <input type="checkbox" checked={ids.includes(reference.id)} disabled={reference.status !== "Published"} onChange={() => toggle(reference.id)} aria-label={"Use " + reference.title + " as a reference"} />
                <span><strong>{reference.title}</strong><small>{reference.id} · {reference.collection}</small></span>
              </label>
              <p>{reference.summary}</p>
              <div className={styles.resultFooter}><span className={reference.status === "Published" ? styles.published : styles.archived}>{reference.status}</span><button type="button" className={styles.textButton} aria-label={"Preview " + reference.title} aria-pressed={previewId === reference.id} onClick={() => setPreviewId(reference.id)}>Preview<Icon name="arrow_forward" /></button></div>
            </article>)}
          </div>
        </div>
        <aside className={styles.preview} aria-label="Reference preview">
          {preview && <>
            <span className={styles.eyebrow}>REFERENCE PREVIEW</span><h3>{preview.title}</h3><span className={styles.referenceBadge}>Reference only</span>
            <dl><div><dt>Solution ID</dt><dd>{preview.id}</dd></div><div><dt>Status</dt><dd>{preview.status}</dd></div><div><dt>Updated</dt><dd>{preview.updated}</dd></div></dl>
            <h4>Content</h4><p>{preview.body}</p>
            {preview.status === "Archived" ? <p className={styles.warning}>This reference is archived. Select its published replacement, SOL-2101.</p> : <button type="button" className={styles.secondary} onClick={() => toggle(preview.id)}><Icon name={ids.includes(preview.id) ? "check" : "add"} />{ids.includes(preview.id) ? "Remove from references" : "Select as reference"}</button>}
          </>}
        </aside>
      </div>
      <div className={styles.guidance}>
        <label className={styles.label} htmlFor="ground-guidance">How should AI use these references? <span>Optional</span></label>
        <textarea id="ground-guidance" rows={2} maxLength={1000} value={guidance} onChange={event => setGuidance(event.target.value)} placeholder="For example: use the security policy for prerequisites and the authentication guide to fill troubleshooting gaps." />
      </div>
      <footer className={styles.dialogFooter}><span>Reference articles will remain unchanged.</span><button type="button" className={styles.secondary} onClick={onCancel}>Cancel</button><button type="button" className={styles.primary} onClick={() => onSave({ enabled: ids.length > 0, referenceIds: ids, guidance: guidance.trim() })}>{ids.length ? "Use " + ids.length + " reference" + (ids.length === 1 ? "" : "s") : "Save without references"}</button></footer>
    </dialog>,
    document.body,
  );
}

export function GroundContextEvidence({ value, mode }: { value: GroundContextSelection; mode: "assist" | "review" | "create" }) {
  const [showExample, setShowExample] = useState(false);
  const references = selectedGroundReferences(value);
  if (!value.enabled || !references.length) return null;
  const relevant = references.filter(reference => reference.applicable);
  return <section className={styles.evidence} aria-label="Ground Context evidence">
    <div className={styles.evidenceHeading}><Icon name="library_books" /><h3>Ground Context</h3><span className={styles.referenceBadge}>{references.length} selected</span></div>
    <p>{mode === "review" ? "Check how reference knowledge could fill a missing answer." : mode === "create" ? "Use selected references to support a new answer." : "Enrich the solution with evidence from selected references."}</p>
    <button type="button" className={styles.secondary} aria-expanded={showExample} onClick={() => setShowExample(current => !current)}>{showExample ? "Hide grounding example" : "Preview grounded additions"}</button>
    {showExample && <div className={styles.evidenceBody}>
      <span className={styles.eyebrow}>ILLUSTRATIVE OUTPUT · VPN EXAMPLE</span>
      {value.guidance && <p><strong>Your guidance:</strong> {value.guidance}</p>}
      <p>{relevant.length} of {references.length} references used in this example. Custom guidance and article edits are not evaluated in the mockup.</p>
      {references.map(reference => <div key={reference.id} className={styles.evidenceItem}>
        <strong>{reference.title}</strong><small>{reference.id} · {reference.applicable ? "Used in example" : "Not used in example"}</small>
        {reference.applicable ? <><h4>Proposed addition · {reference.field}</h4><p>{reference.addition}</p><details><summary>View supporting excerpt</summary><blockquote>{reference.excerpt}</blockquote></details></> : <p>This reference applies to external vendors. The sample solution covers employee VPN access, so no vendor requirements were added.</p>}
      </div>)}
      <p className={styles.footnote}>Example suggestions only. Review applicability before adding them to an article.</p>
    </div>}
  </section>;
}