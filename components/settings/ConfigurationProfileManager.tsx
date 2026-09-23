"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConfigurationProfile, ConfigurationProfileKind, ConfigurationSource } from "@/lib/configuration/types";

type Connection = { id: string; name: string; isDefault: boolean };
type Metadata = { collections: { code: string; label: string }[]; taxonomies: string[] };
type Draft = { name: string; isDefault: boolean; collection: string; taxonomy: string; guidance: string; sources: ConfigurationSource[] };
const blank = (): Draft => ({ name: "", isDefault: false, collection: "", taxonomy: "", guidance: "", sources: [{ type: "text", text: "" }] });

function sourceLabel(source: ConfigurationSource) {
  if (source.type === "text") return "Written instruction";
  if (source.type === "document") return source.label ?? "Uploaded document";
  return `Solution #${source.solutionId}`;
}

export function ConfigurationProfileManager({ kind, title, description, icon }: { kind: ConfigurationProfileKind; title: string; description: string; icon: string }) {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [metadata, setMetadata] = useState<Metadata>({ collections: [], taxonomies: [] });
  const [profiles, setProfiles] = useState<ConfigurationProfile[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ra-connections").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not load customers.");
      if (!cancelled) {
        const next = data.connections as Connection[];
        setConnections(next);
        setConnectionId(current => current || next.find(connection => connection.isDefault)?.id || next[0]?.id || "");
      }
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load customers."); });
    return () => { cancelled = true; };
  }, []);

  async function load(customerId: string) {
    if (!customerId) return;
    setLoading(true); setMessage("");
    try {
      const [profilesResponse, metadataResponse] = await Promise.all([
        fetch(`/api/configuration/profiles?connectionId=${encodeURIComponent(customerId)}&kind=${encodeURIComponent(kind)}`),
        fetch(`/api/metadata?connectionId=${encodeURIComponent(customerId)}`),
      ]);
      const profileData = await profilesResponse.json();
      if (!profilesResponse.ok) throw new Error(profileData.error ?? "Could not load profiles.");
      setProfiles(profileData.profiles);
      if (metadataResponse.ok) {
        const metadataData = await metadataResponse.json();
        setMetadata({ collections: metadataData.collections ?? [], taxonomies: metadataData.taxonomies ?? [] });
      } else setMetadata({ collections: [], taxonomies: [] });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load profiles."); }
    finally { setLoading(false); }
  }
  // This effect synchronizes externally fetched customer configuration with the selected customer.
  // eslint-disable-next-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  useEffect(() => { void load(connectionId); }, [connectionId, kind]);

  const scopeLabel = useMemo(() => (profile: ConfigurationProfile) => {
    if (profile.isDefault) return "Company default";
    return [profile.scope.collection && `Collection: ${profile.scope.collection}`, profile.scope.taxonomy && `Taxonomy: ${profile.scope.taxonomy.replaceAll("//", " › ")}`].filter(Boolean).join(" · ");
  }, []);

  function resetForm() { setDraft(blank()); setEditingId(null); setMessage(""); }
  function startEdit(profile: ConfigurationProfile) {
    setEditingId(profile.id);
    setDraft({ name: profile.name, isDefault: profile.isDefault, collection: profile.scope.collection ?? "", taxonomy: profile.scope.taxonomy ?? "", guidance: profile.guidance, sources: profile.sources });
    setMessage("");
  }
  function replaceSource(index: number, source: ConfigurationSource) { setDraft(current => ({ ...current, sources: current.sources.map((item, itemIndex) => itemIndex === index ? source : item) })); }
  function removeSource(index: number) { setDraft(current => ({ ...current, sources: current.sources.filter((_, itemIndex) => itemIndex !== index) })); }

  async function uploadDocument(file: File) {
    if (!connectionId) return;
    setUploading(true); setMessage("");
    try {
      const form = new FormData(); form.set("connectionId", connectionId); form.set("file", file);
      const response = await fetch("/api/configuration/documents", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not upload the document.");
      setDraft(current => ({ ...current, sources: [...current.sources, { type: "document", documentId: data.document.id, label: data.document.name }] }));
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not upload the document."); }
    finally { setUploading(false); }
  }

  function cleanSources(): ConfigurationSource[] {
    const sources: ConfigurationSource[] = [];
    for (const source of draft.sources) {
      if (source.type === "text" && source.text.trim()) sources.push({ type: "text", text: source.text.trim() });
      else if (source.type === "solution" && source.solutionId.trim()) sources.push({ type: "solution", solutionId: source.solutionId.trim() });
      else if (source.type === "document") sources.push(source);
    }
    return sources;
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    const sources = cleanSources();
    if (!sources.length) { setMessage("Add at least one written instruction, document, or solution."); return; }
    setSaving(true); setMessage("");
    const profileDraft = { kind, name: draft.name, isDefault: draft.isDefault, scope: { ...(draft.collection.trim() ? { collection: draft.collection.trim() } : {}), ...(draft.taxonomy.trim() ? { taxonomy: draft.taxonomy.trim() } : {}) }, guidance: draft.guidance, sources };
    try {
      const response = await fetch("/api/configuration/profiles", { method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(editingId ? { id: editingId, connectionId, draft: profileDraft } : { connectionId, draft: profileDraft }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save the profile.");
      resetForm(); await load(connectionId); setMessage(editingId ? "Profile updated." : "Profile created.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the profile."); }
    finally { setSaving(false); }
  }
  async function archive(profile: ConfigurationProfile) {
    if (!window.confirm(`Archive ${profile.name}? Existing runs keep their saved snapshot.`)) return;
    setSaving(true); setMessage("");
    try {
      const response = await fetch(`/api/configuration/profiles?id=${encodeURIComponent(profile.id)}&connectionId=${encodeURIComponent(connectionId)}`, { method: "DELETE" });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not archive the profile.");
      if (editingId === profile.id) resetForm(); await load(connectionId); setMessage("Profile archived.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not archive the profile."); }
    finally { setSaving(false); }
  }

  const sourceNoun = kind === "ground_truth" ? "reference context" : "content standard";
  return <main style={{ padding: 34, maxWidth: 1120, margin: "0 auto" }}>
    <p style={{ color: "#2574db", fontWeight: 700, fontSize: 12, textTransform: "uppercase" }}>Knowledge Studio configuration</p>
    <h1 style={{ margin: "4px 0 8px" }}><span className="ms" aria-hidden="true" style={{ color: "#2574db", verticalAlign: "-4px", marginRight: 8 }}>{icon}</span>{title}</h1>
    <p style={{ color: "#6b7786", maxWidth: 760 }}>{description}</p>
    {message && <p className="ks-card" role="status" style={{ padding: 14, marginTop: 20 }}>{message}</p>}
    <section className="ks-card" style={{ padding: 20, marginTop: 24 }} aria-label="Customer selection">
      <label className="form-label" style={{ maxWidth: 440 }}>Customer<select className="form-input" value={connectionId} onChange={event => { setConnectionId(event.target.value); resetForm(); }} disabled={!connections.length}>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}{connection.isDefault ? " (Default)" : ""}</option>)}</select></label>
    </section>
    <section className="ks-card" style={{ padding: 22, marginTop: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16 }}><div><h2 style={{ margin: 0 }}>Active profiles</h2><p style={{ margin: "6px 0 0", color: "#6b7786", fontSize: 13 }}>A more-specific collection and taxonomy profile replaces the company default.</p></div><span className="ks-chip">{profiles.length} active</span></div>
      {loading ? <p role="status">Loading profiles…</p> : !profiles.length ? <p style={{ color: "#6b7786" }}>No active {sourceNoun} profile exists for this customer.</p> : <div style={{ display: "grid", gap: 10, marginTop: 16 }}>{profiles.map(profile => <article key={profile.id} style={{ display: "flex", gap: 14, alignItems: "flex-start", border: "1px solid #e0e3e6", borderRadius: 8, padding: 16 }}><span className="ms" aria-hidden="true" style={{ color: "#2574db" }}>{profile.isDefault ? "verified" : "account_tree"}</span><div style={{ flex: 1, minWidth: 0 }}><strong>{profile.name}</strong><div style={{ color: "#6b7786", fontSize: 12, marginTop: 4 }}>{scopeLabel(profile)} · {profile.sources.length} source{profile.sources.length === 1 ? "" : "s"}</div><div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>{profile.sources.map((source, index) => <span className="ks-chip" key={`${source.type}-${index}`}>{sourceLabel(source)}</span>)}</div></div><div style={{ display: "flex", gap: 8 }}><button className="ds-btn ds-btn-secondary" type="button" onClick={() => startEdit(profile)} disabled={saving}>Edit</button><button className="ds-btn ds-btn-secondary" type="button" onClick={() => void archive(profile)} disabled={saving}>Archive</button></div></article>)}</div>}
    </section>
    <form className="ks-card" onSubmit={save} style={{ padding: 22, marginTop: 20 }}>
      <h2 style={{ marginTop: 0 }}>{editingId ? "Edit profile" : "Create profile"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        <label className="form-label">Profile name<input className="form-input" required maxLength={120} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder={kind === "ground_truth" ? "Example: VPN support evidence" : "Example: External support content"} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 28 }}><input type="checkbox" checked={draft.isDefault} onChange={event => setDraft(current => ({ ...current, isDefault: event.target.checked, ...(event.target.checked ? { collection: "", taxonomy: "" } : {}) }))} />Use as the company default</label>
        <label className="form-label">Collection <span className="req">Optional</span><input className="form-input" list="configuration-collections" disabled={draft.isDefault} value={draft.collection} onChange={event => setDraft(current => ({ ...current, collection: event.target.value }))} placeholder="Match a RightAnswers collection" /><datalist id="configuration-collections">{metadata.collections.map(collection => <option key={collection.code} value={collection.code}>{collection.label}</option>)}</datalist></label>
        <label className="form-label">Taxonomy <span className="req">Optional</span><input className="form-input" list="configuration-taxonomies" disabled={draft.isDefault} value={draft.taxonomy} onChange={event => setDraft(current => ({ ...current, taxonomy: event.target.value }))} placeholder="Match a taxonomy path" /><datalist id="configuration-taxonomies">{metadata.taxonomies.map(taxonomy => <option key={taxonomy} value={taxonomy}>{taxonomy.replaceAll("//", " › ")}</option>)}</datalist></label>
      </div>
      {kind === "ground_truth" && <label className="form-label" style={{ marginTop: 16 }}>Usage guidance <span className="req">Optional</span><textarea className="form-textarea" rows={3} maxLength={4000} value={draft.guidance} onChange={event => setDraft(current => ({ ...current, guidance: event.target.value }))} placeholder="Explain how AI should apply this reference context." /></label>}
      <div style={{ marginTop: 20 }}><h3 style={{ marginBottom: 6 }}>Sources</h3><p style={{ margin: "0 0 12px", color: "#6b7786", fontSize: 13 }}>Combine written instructions, uploaded documents, and RightAnswers solution IDs. The exact source content is frozen when a pipeline starts.</p>
        <div style={{ display: "grid", gap: 10 }}>{draft.sources.map((source, index) => <div key={`${source.type}-${index}`} style={{ border: "1px solid #e0e3e6", borderRadius: 6, padding: 12 }}>
          {source.type === "text" && <label className="form-label" style={{ margin: 0 }}>Written instruction<textarea className="form-textarea" rows={3} maxLength={120000} value={source.text} onChange={event => replaceSource(index, { type: "text", text: event.target.value })} placeholder="Write the rules or reference material AI should use." /></label>}
          {source.type === "solution" && <label className="form-label" style={{ margin: 0 }}>RightAnswers solution ID<input className="form-input" inputMode="numeric" pattern="\d{15}" maxLength={15} value={source.solutionId} onChange={event => replaceSource(index, { type: "solution", solutionId: event.target.value })} placeholder="15-digit solution ID" /></label>}
          {source.type === "document" && <div><strong>{source.label ?? "Uploaded document"}</strong><p style={{ color: "#6b7786", fontSize: 12, margin: "5px 0 0" }}>Document source attached</p></div>}
          <button className="ds-btn ds-btn-secondary" type="button" style={{ marginTop: 10 }} onClick={() => removeSource(index)}>Remove source</button>
        </div>)}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}><button className="ds-btn ds-btn-secondary" type="button" onClick={() => setDraft(current => ({ ...current, sources: [...current.sources, { type: "text", text: "" }] }))}>Add written instruction</button><button className="ds-btn ds-btn-secondary" type="button" onClick={() => setDraft(current => ({ ...current, sources: [...current.sources, { type: "solution", solutionId: "" }] }))}>Add solution ID</button><label className="ds-btn ds-btn-secondary" style={{ cursor: uploading ? "wait" : "pointer" }}><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} disabled={uploading || !connectionId} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); event.currentTarget.value = ""; }} />{uploading ? "Uploading document…" : "Add document"}</label></div>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}><button className="ds-btn ds-btn-primary" disabled={saving || uploading || !connectionId} type="submit">{saving ? "Saving…" : editingId ? "Save changes" : "Create profile"}</button>{editingId && <button className="ds-btn ds-btn-secondary" type="button" disabled={saving} onClick={resetForm}>Cancel</button>}</div>
    </form>
  </main>;
}
