"use client";

import { useEffect, useMemo, useState } from "react";
import type { ConfigurationProfile, ConfigurationProfileKind, ConfigurationSource } from "@/lib/configuration/types";
import type { KbSearchRow } from "@/app/api/kb/search/route";

type Connection = { id: string; name: string; isDefault: boolean };
type Metadata = { collections: { code: string; label: string }[]; taxonomies: string[] };
type Draft = { name: string; isDefault: boolean; collections: string[]; taxonomies: string[]; operator: "and" | "or"; guidance: string; sources: ConfigurationSource[] };
const blank = (): Draft => ({ name: "", isDefault: false, collections: [], taxonomies: [], operator: "and", guidance: "", sources: [{ type: "text", text: "" }] });

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
  const [collectionInput, setCollectionInput] = useState("");
  const [taxonomyInput, setTaxonomyInput] = useState("");
  const [solutionQuery, setSolutionQuery] = useState("");
  const [solutionRows, setSolutionRows] = useState<KbSearchRow[]>([]);
  const [knownSolutions, setKnownSolutions] = useState<Record<string, KbSearchRow>>({});
  const [searchingSolutions, setSearchingSolutions] = useState(false);
  const [solutionSearchError, setSolutionSearchError] = useState("");

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

  useEffect(() => {
    if (!connectionId || !solutionQuery.trim()) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setSearchingSolutions(true); setSolutionSearchError("");
      try {
        const response = await fetch(`/api/kb/search?q=${encodeURIComponent(solutionQuery.trim())}&connectionId=${encodeURIComponent(connectionId)}`, { signal: controller.signal });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not search solutions.");
        if (!controller.signal.aborted) {
          setSolutionRows(data.rows ?? []);
          setKnownSolutions(current => ({ ...current, ...Object.fromEntries((data.rows ?? []).map((row: KbSearchRow) => [row.id, row])) }));
        }
      } catch (error) { if (!controller.signal.aborted) setSolutionSearchError(error instanceof Error ? error.message : "Could not search solutions."); }
      finally { if (!controller.signal.aborted) setSearchingSolutions(false); }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [connectionId, solutionQuery]);

  const scopeLabel = useMemo(() => (profile: ConfigurationProfile) => {
    if (profile.isDefault) return "Company default";
    const parts = [profile.scope.collections.length && `Collections: ${profile.scope.collections.join(", ")}`, profile.scope.taxonomies.length && `Taxonomies: ${profile.scope.taxonomies.map(taxonomy => taxonomy.replaceAll("//", " › ")).join(", ")}`].filter(Boolean);
    return `${parts.join(" · ")} · ${profile.scope.operator.toUpperCase()}`;
  }, []);

  function resetForm() { setDraft(blank()); setEditingId(null); setMessage(""); setCollectionInput(""); setTaxonomyInput(""); setSolutionQuery(""); setSolutionRows([]); }
  function startEdit(profile: ConfigurationProfile) {
    setEditingId(profile.id);
    setDraft({ name: profile.name, isDefault: profile.isDefault, collections: profile.scope.collections, taxonomies: profile.scope.taxonomies, operator: profile.scope.operator, guidance: profile.guidance, sources: profile.sources });
    setMessage("");
  }
  function replaceSource(index: number, source: ConfigurationSource) { setDraft(current => ({ ...current, sources: current.sources.map((item, itemIndex) => itemIndex === index ? source : item) })); }
  function removeSource(index: number) { setDraft(current => ({ ...current, sources: current.sources.filter((_, itemIndex) => itemIndex !== index) })); }
  function addScopeValue(type: "collections" | "taxonomies", value: string) {
    const trimmed = value.trim();
    if (!trimmed) return;
    setDraft(current => current[type].some(item => item.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0) ? current : { ...current, [type]: [...current[type], trimmed] });
    if (type === "collections") setCollectionInput(""); else setTaxonomyInput("");
  }
  function removeScopeValue(type: "collections" | "taxonomies", value: string) { setDraft(current => ({ ...current, [type]: current[type].filter(item => item !== value) })); }
  function toggleSolution(solutionId: string) {
    setDraft(current => {
      const selected = current.sources.some(source => source.type === "solution" && source.solutionId === solutionId);
      return { ...current, sources: selected ? current.sources.filter(source => source.type !== "solution" || source.solutionId !== solutionId) : [...current.sources, { type: "solution", solutionId }] };
    });
  }

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
    const profileDraft = { kind, name: draft.name, isDefault: draft.isDefault, scope: { collections: draft.collections, taxonomies: draft.taxonomies, operator: draft.operator }, guidance: draft.guidance, sources };
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
        <label style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 28 }}><input type="checkbox" checked={draft.isDefault} onChange={event => setDraft(current => ({ ...current, isDefault: event.target.checked, ...(event.target.checked ? { collections: [], taxonomies: [] } : {}) }))} />Use as the company default</label>
        <div className="form-label">Collections <span className="req">Optional</span><div style={{ display: "flex", gap: 8 }}><input className="form-input" list="configuration-collections" disabled={draft.isDefault} value={collectionInput} onChange={event => setCollectionInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addScopeValue("collections", collectionInput); } }} placeholder="Add a RightAnswers collection" /><button className="ds-btn ds-btn-secondary" type="button" disabled={draft.isDefault} onClick={() => addScopeValue("collections", collectionInput)}>Add</button></div><datalist id="configuration-collections">{metadata.collections.map(collection => <option key={collection.code} value={collection.code}>{collection.label}</option>)}</datalist><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{draft.collections.map(collection => <button className="ks-chip" type="button" key={collection} disabled={draft.isDefault} onClick={() => removeScopeValue("collections", collection)} aria-label={`Remove collection ${collection}`}>{collection} ×</button>)}</div></div>
        <div className="form-label">Taxonomies <span className="req">Optional</span><div style={{ display: "flex", gap: 8 }}><input className="form-input" list="configuration-taxonomies" disabled={draft.isDefault} value={taxonomyInput} onChange={event => setTaxonomyInput(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addScopeValue("taxonomies", taxonomyInput); } }} placeholder="Add a taxonomy path" /><button className="ds-btn ds-btn-secondary" type="button" disabled={draft.isDefault} onClick={() => addScopeValue("taxonomies", taxonomyInput)}>Add</button></div><datalist id="configuration-taxonomies">{metadata.taxonomies.map(taxonomy => <option key={taxonomy} value={taxonomy}>{taxonomy.replaceAll("//", " › ")}</option>)}</datalist><div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>{draft.taxonomies.map(taxonomy => <button className="ks-chip" type="button" key={taxonomy} disabled={draft.isDefault} onClick={() => removeScopeValue("taxonomies", taxonomy)} aria-label={`Remove taxonomy ${taxonomy}`}>{taxonomy.replaceAll("//", " › ")} ×</button>)}</div></div>
      </div>
      {!draft.isDefault && <section style={{ marginTop: 16 }} aria-label="Scope matching rule"><label className="form-label">Match rule<select className="form-input" value={draft.operator} onChange={event => setDraft(current => ({ ...current, operator: event.target.value as "and" | "or" }))}><option value="and">Collections AND taxonomies must match</option><option value="or">Any selected collection OR taxonomy can match</option></select></label><p style={{ color: "#6b7786", fontSize: 12, margin: "6px 0 0" }}>AND requires one value from each populated group. OR applies when any selected metadata value matches.</p></section>}
      {kind === "ground_truth" && <label className="form-label" style={{ marginTop: 16 }}>Usage guidance <span className="req">Optional</span><textarea className="form-textarea" rows={3} maxLength={4000} value={draft.guidance} onChange={event => setDraft(current => ({ ...current, guidance: event.target.value }))} placeholder="Explain how AI should apply this reference context." /></label>}
      <div style={{ marginTop: 20 }}><h3 style={{ marginBottom: 6 }}>Sources</h3><p style={{ margin: "0 0 12px", color: "#6b7786", fontSize: 13 }}>Combine written instructions, uploaded documents, and selected RightAnswers solutions. The exact source content is frozen when a pipeline starts.</p>
        <div style={{ display: "grid", gap: 10 }}>{draft.sources.map((source, index) => <div key={`${source.type}-${index}`} style={{ border: "1px solid #e0e3e6", borderRadius: 6, padding: 12 }}>
          {source.type === "text" && <label className="form-label" style={{ margin: 0 }}>Written instruction<textarea className="form-textarea" rows={3} maxLength={120000} value={source.text} onChange={event => replaceSource(index, { type: "text", text: event.target.value })} placeholder="Write the rules or reference material AI should use." /></label>}
          {source.type === "solution" && <div><strong>{knownSolutions[source.solutionId]?.title ?? `Solution #${source.solutionId}`}</strong><p style={{ color: "#6b7786", fontSize: 12, margin: "5px 0 0" }}>RightAnswers solution selected through search</p></div>}
          {source.type === "document" && <div><strong>{source.label ?? "Uploaded document"}</strong><p style={{ color: "#6b7786", fontSize: 12, margin: "5px 0 0" }}>Document source attached</p></div>}
          <button className="ds-btn ds-btn-secondary" type="button" style={{ marginTop: 10 }} onClick={() => removeSource(index)}>Remove source</button>
        </div>)}</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}><button className="ds-btn ds-btn-secondary" type="button" onClick={() => setDraft(current => ({ ...current, sources: [...current.sources, { type: "text", text: "" }] }))}>Add written instruction</button><label className="ds-btn ds-btn-secondary" style={{ cursor: uploading ? "wait" : "pointer" }}><input type="file" accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }} disabled={uploading || !connectionId} onChange={event => { const file = event.target.files?.[0]; if (file) void uploadDocument(file); event.currentTarget.value = ""; }} />{uploading ? "Uploading document…" : "Add document"}</label></div>
        <section style={{ borderTop: "1px solid #e0e3e6", marginTop: 16, paddingTop: 16 }} aria-label="Search RightAnswers solutions"><label className="form-label">Search RightAnswers solutions<input className="form-input" type="search" value={solutionQuery} onChange={event => { const value = event.target.value; setSolutionQuery(value); setSolutionRows([]); setSearchingSolutions(!!value.trim()); setSolutionSearchError(""); }} placeholder="Search your knowledge base" /></label><p style={{ color: "#6b7786", fontSize: 12, margin: "6px 0 10px" }}>Select one or more solutions to append as source material.</p>{solutionSearchError && <p role="alert">{solutionSearchError}</p>}{searchingSolutions && <p role="status">Searching solutions…</p>}{solutionQuery.trim() && !searchingSolutions && !solutionSearchError && !solutionRows.length && <p>No matching solutions. Try another search.</p>}<div style={{ display: "grid", gap: 8 }}>{solutionRows.map(row => { const selected = draft.sources.some(source => source.type === "solution" && source.solutionId === row.id); return <label key={row.id} style={{ display: "flex", alignItems: "flex-start", gap: 10, border: "1px solid #e0e3e6", borderRadius: 6, padding: 10 }}><input type="checkbox" checked={selected} disabled={!selected && draft.sources.length >= 24} onChange={() => toggleSolution(row.id)} /><span><strong>{row.title}</strong><small style={{ display: "block", color: "#6b7786", marginTop: 2 }}>{row.id} · {row.meta}</small></span></label>; })}</div></section>
      </div>
      <div style={{ display: "flex", gap: 10, marginTop: 22 }}><button className="ds-btn ds-btn-primary" disabled={saving || uploading || !connectionId} type="submit">{saving ? "Saving…" : editingId ? "Save changes" : "Create profile"}</button>{editingId && <button className="ds-btn ds-btn-secondary" type="button" disabled={saving} onClick={resetForm}>Cancel</button>}</div>
    </form>
  </main>;
}
