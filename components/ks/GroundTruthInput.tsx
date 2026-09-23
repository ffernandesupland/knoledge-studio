"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { GroundContextInput } from "./GroundContextInput";
import type { GroundContextInput as GroundSelection, GroundReference } from "@/lib/ground-context/types";
import type { GroundTruthSelection } from "@/lib/ground-context/ground-truth";
import type { ConfigurationProfile } from "@/lib/configuration/types";
import styles from "./GroundContext.module.css";

type Metadata = { collections: { code: string; label: string }[]; taxonomies: string[] };
type Document = { id: string; name: string };

export function GroundTruthInput({ value, onChange, selection, onSelectionChange, documents, onDocumentsChange, excludedIds, savedReferences, connectionId }: {
  value: GroundSelection;
  onChange: (value: GroundSelection) => void;
  selection?: Exclude<GroundTruthSelection, { mode: "manual" }>;
  onSelectionChange: (value: Exclude<GroundTruthSelection, { mode: "manual" }> | undefined) => void;
  documents: Document[];
  onDocumentsChange: (documents: Document[]) => void;
  excludedIds: string[];
  savedReferences?: GroundReference[];
  connectionId?: string;
}) {
  const [profiles, setProfiles] = useState<ConfigurationProfile[]>([]);
  const [metadata, setMetadata] = useState<Metadata>({ collections: [], taxonomies: [] });
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");
  const mode = selection?.mode ?? "manual";

  useEffect(() => {
    if (!connectionId) return;
    const controller = new AbortController();
    // Loading reflects the external customer catalog request.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    void Promise.all([
      fetch(`/api/configuration/profiles?connectionId=${encodeURIComponent(connectionId)}&kind=ground_truth`, { signal: controller.signal }),
      fetch(`/api/metadata?connectionId=${encodeURIComponent(connectionId)}`, { signal: controller.signal }),
    ]).then(async ([profileResponse, metadataResponse]) => {
      const profileData = await profileResponse.json();
      if (!profileResponse.ok) throw new Error(profileData.error ?? "Could not load Ground Truth bundles.");
      if (!controller.signal.aborted) {
        setProfiles(profileData.profiles ?? []);
        setMetadata(metadataResponse.ok ? await metadataResponse.json() : { collections: [], taxonomies: [] });
      }
    }).catch(error => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "Could not load Ground Truth options."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [connectionId]);

  function chooseMode(next: "manual" | "bundle" | "scope") {
    setMessage("");
    if (next === "manual") { onSelectionChange(undefined); return; }
    if (next === "bundle") {
      if (!profiles.length) { setMessage("Create an active Ground Truth bundle before selecting this mode."); return; }
      onSelectionChange({ mode: "bundle", bundleId: profiles[0].id, guidance: "" });
    }
    else onSelectionChange({ mode: "scope", scope: {}, guidance: "" });
  }

  async function upload(file: File) {
    if (!connectionId) return;
    setUploading(true); setMessage("");
    try {
      const form = new FormData(); form.set("connectionId", connectionId); form.set("file", file);
      const response = await fetch("/api/configuration/documents", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not upload the document.");
      onDocumentsChange([...documents, { id: data.document.id, name: data.document.name }]);
      if (!value.enabled) onChange({ ...value, enabled: true });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not upload the document."); }
    finally { setUploading(false); }
  }

  return <section className={styles.card} aria-label="Ground Truth">
    <div className={styles.cardHeading}><span className={styles.contextIcon}><span className="ms" aria-hidden="true">library_books</span></span><div className={styles.cardTitle}><h2>Ground Truth</h2><p>Use one source mode for this run. The selected material is frozen before analysis.</p></div></div>
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 16 }} role="radiogroup" aria-label="Ground Truth source mode">
      {([ ["manual", "Direct sources"], ["bundle", "Saved bundle"], ["scope", "Match collection or taxonomy"] ] as const).map(([key, label]) => <label key={key} className="ks-chip" style={{ cursor: "pointer", padding: "7px 10px" }}><input type="radio" name="ground-truth-mode" checked={mode === key} onChange={() => chooseMode(key)} /> {label}</label>)}
    </div>
    {mode === "manual" && <>
      <GroundContextInput value={value} onChange={onChange} excludedIds={excludedIds} savedReferences={savedReferences} connectionId={connectionId} />
      <div style={{ marginTop: 14, borderTop: "1px solid #e0e3e6", paddingTop: 14 }}><strong style={{ fontSize: 13 }}>Reference documents</strong><p className={styles.footnote} style={{ marginTop: 5 }}>Add PDF, DOCX, or text documents alongside direct solution references.</p>
        {documents.map(document => <div className={styles.result} key={document.id}><strong>{document.name}</strong><button type="button" className={styles.textButton} onClick={() => onDocumentsChange(documents.filter(item => item.id !== document.id))}>Remove</button></div>)}
        <label className={styles.secondary} style={{ marginTop: 10, cursor: uploading ? "wait" : "pointer" }}><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} disabled={!connectionId || uploading} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.currentTarget.value = ""; }} />{uploading ? "Uploading document…" : "Add document"}</label>
      </div>
    </>}
    {mode === "bundle" && <div style={{ marginTop: 16 }}><label className={styles.label}>Saved Ground Truth bundle<select className="form-input" value={selection?.mode === "bundle" ? selection.bundleId : ""} onChange={event => onSelectionChange({ mode: "bundle", bundleId: event.target.value, guidance: selection?.mode === "bundle" ? selection.guidance : "" })}><option value="">Select a bundle</option>{profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}{profile.isDefault ? " (Company default)" : ""}</option>)}</select></label>{!loading && !profiles.length && <p className={styles.warning}>No active bundle is available. <Link href="/ground-truth-management">Create one in Ground Truth Management</Link>.</p>}</div>}
    {mode === "scope" && <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}><label className={styles.label}>Collection <span>Optional</span><input className="form-input" list="ground-truth-collections" value={selection?.mode === "scope" ? selection.scope.collection ?? "" : ""} onChange={event => onSelectionChange({ mode: "scope", scope: { ...(selection?.mode === "scope" ? selection.scope : {}), ...(event.target.value ? { collection: event.target.value } : {}) }, guidance: selection?.mode === "scope" ? selection.guidance : "" })} /><datalist id="ground-truth-collections">{metadata.collections.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</datalist></label><label className={styles.label}>Taxonomy <span>Optional</span><input className="form-input" list="ground-truth-taxonomies" value={selection?.mode === "scope" ? selection.scope.taxonomy ?? "" : ""} onChange={event => onSelectionChange({ mode: "scope", scope: { ...(selection?.mode === "scope" ? selection.scope : {}), ...(event.target.value ? { taxonomy: event.target.value } : {}) }, guidance: selection?.mode === "scope" ? selection.guidance : "" })} /><datalist id="ground-truth-taxonomies">{metadata.taxonomies.map(item => <option key={item} value={item} />)}</datalist></label></div>}
    {mode !== "manual" && <label className={styles.label} style={{ display: "block", marginTop: 14 }}>Usage guidance <span>Optional</span><textarea className="form-textarea" rows={2} maxLength={1000} value={selection?.guidance ?? ""} onChange={event => selection?.mode === "bundle" ? onSelectionChange({ ...selection, guidance: event.target.value }) : selection?.mode === "scope" ? onSelectionChange({ ...selection, guidance: event.target.value }) : undefined} placeholder="Explain how AI should apply this Ground Truth." /></label>}
    {message && <p className={styles.warning} role="alert">{message}</p>}
  </section>;
}
