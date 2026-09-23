"use client";

import { useEffect, useState } from "react";
import type { Snippet } from "@/lib/configuration/types";

type Connection = { id: string; name: string; isDefault: boolean };
type Draft = { name: string; purpose: string; html: string; active: boolean; collection: string; taxonomy: string };
const blank = (): Draft => ({ name: "", purpose: "", html: "", active: true, collection: "", taxonomy: "" });

export function SnippetsManager() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [connectionId, setConnectionId] = useState("");
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [draft, setDraft] = useState<Draft>(blank);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/ra-connections").then(async response => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not load customers.");
      if (!cancelled) { const next = data.connections as Connection[]; setConnections(next); setConnectionId(current => current || next.find(connection => connection.isDefault)?.id || next[0]?.id || ""); }
    }).catch(error => { if (!cancelled) setMessage(error instanceof Error ? error.message : "Could not load customers."); });
    return () => { cancelled = true; };
  }, []);
  async function load(customerId: string) {
    if (!customerId) return;
    setLoading(true); setMessage("");
    try { const response = await fetch(`/api/configuration/snippets?connectionId=${encodeURIComponent(customerId)}`), data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not load snippets."); setSnippets(data.snippets); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not load snippets."); }
    finally { setLoading(false); }
  }
  // Loading follows the externally selected customer, rather than derived component state.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(connectionId); }, [connectionId]);

  function reset() { setDraft(blank()); setEditingId(null); setMessage(""); }
  function edit(snippet: Snippet) { setEditingId(snippet.id); setDraft({ name: snippet.name, purpose: snippet.purpose, html: snippet.html, active: snippet.active, collection: snippet.scope.collection ?? "", taxonomy: snippet.scope.taxonomy ?? "" }); setMessage(""); }
  async function save(event: React.FormEvent) {
    event.preventDefault(); setSaving(true); setMessage("");
    const snippetDraft = { name: draft.name, purpose: draft.purpose, html: draft.html, active: draft.active, scope: { ...(draft.collection.trim() ? { collection: draft.collection.trim() } : {}), ...(draft.taxonomy.trim() ? { taxonomy: draft.taxonomy.trim() } : {}) } };
    try {
      const response = await fetch("/api/configuration/snippets", { method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(editingId ? { id: editingId, connectionId, draft: snippetDraft } : { connectionId, draft: snippetDraft }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not save the snippet.");
      const action = editingId ? "Snippet updated." : "Snippet created."; reset(); await load(connectionId); setMessage(action);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the snippet."); }
    finally { setSaving(false); }
  }
  async function archive(snippet: Snippet) {
    if (!window.confirm(`Archive ${snippet.name}? Existing runs keep their saved snippet snapshot.`)) return;
    setSaving(true); setMessage("");
    try { const response = await fetch(`/api/configuration/snippets?id=${encodeURIComponent(snippet.id)}&connectionId=${encodeURIComponent(connectionId)}`, { method: "DELETE" }), data = await response.json(); if (!response.ok) throw new Error(data.error ?? "Could not archive the snippet."); if (editingId === snippet.id) reset(); await load(connectionId); setMessage("Snippet archived."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not archive the snippet."); }
    finally { setSaving(false); }
  }
  return <main style={{ padding: 34, maxWidth: 1120, margin: "0 auto" }}>
    <p style={{ color: "#2574db", fontWeight: 700, fontSize: 12, textTransform: "uppercase" }}>Knowledge Studio configuration</p>
    <h1 style={{ margin: "4px 0 8px" }}><span className="ms" aria-hidden="true" style={{ color: "#2574db", verticalAlign: "-4px", marginRight: 8 }}>code_blocks</span>Snippets Management</h1>
    <p style={{ color: "#6b7786", maxWidth: 760 }}>Manage reusable HTML structures that Knowledge Studio may use when authoring and revising content. Snippets are sanitized and are not supplied to unrelated planning or research prompts.</p>
    {message && <p className="ks-card" role="status" style={{ padding: 14, marginTop: 20 }}>{message}</p>}
    <section className="ks-card" style={{ padding: 20, marginTop: 24 }}><label className="form-label" style={{ maxWidth: 440 }}>Customer<select className="form-input" value={connectionId} onChange={event => { setConnectionId(event.target.value); reset(); }} disabled={!connections.length}>{connections.map(connection => <option key={connection.id} value={connection.id}>{connection.name}{connection.isDefault ? " (Default)" : ""}</option>)}</select></label></section>
    <section className="ks-card" style={{ padding: 22, marginTop: 20 }}><div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center" }}><div><h2 style={{ margin: 0 }}>Active snippets</h2><p style={{ margin: "6px 0 0", color: "#6b7786", fontSize: 13 }}>The model can choose a relevant snippet; it never treats snippet HTML as executable instructions.</p></div><span className="ks-chip">{snippets.length} active</span></div>
      {loading ? <p role="status">Loading snippets…</p> : !snippets.length ? <p style={{ color: "#6b7786" }}>No active snippets exist for this customer.</p> : <div style={{ display: "grid", gap: 12, marginTop: 16 }}>{snippets.map(snippet => <article key={snippet.id} style={{ border: "1px solid #e0e3e6", borderRadius: 8, padding: 16 }}><div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}><span className="ms" aria-hidden="true" style={{ color: "#2574db" }}>code</span><div style={{ flex: 1, minWidth: 0 }}><strong>{snippet.name}</strong><p style={{ margin: "4px 0", color: "#6b7786", fontSize: 12 }}>{snippet.purpose || "No usage guidance"}{snippet.scope.collection || snippet.scope.taxonomy ? ` · ${[snippet.scope.collection && `Collection: ${snippet.scope.collection}`, snippet.scope.taxonomy && `Taxonomy: ${snippet.scope.taxonomy.replaceAll("//", " › ")}`].filter(Boolean).join(" · ")}` : " · Global"}</p></div><div style={{ display: "flex", gap: 8 }}><button className="ds-btn ds-btn-secondary" type="button" onClick={() => edit(snippet)}>Edit</button><button className="ds-btn ds-btn-secondary" type="button" onClick={() => void archive(snippet)}>Archive</button></div></div><iframe title={`${snippet.name} preview`} sandbox="" srcDoc={snippet.html} style={{ width: "100%", minHeight: 110, border: "1px solid #e0e3e6", borderRadius: 5, marginTop: 12, background: "white" }} /></article>)}</div>}
    </section>
    <form className="ks-card" onSubmit={save} style={{ padding: 22, marginTop: 20 }}><h2 style={{ marginTop: 0 }}>{editingId ? "Edit snippet" : "Create snippet"}</h2><div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}><label className="form-label">Snippet name<input className="form-input" required maxLength={120} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} placeholder="Example: Prerequisites callout" /></label><label className="form-label">Purpose <span className="req">Optional</span><input className="form-input" maxLength={2000} value={draft.purpose} onChange={event => setDraft(current => ({ ...current, purpose: event.target.value }))} placeholder="When should AI use this structure?" /></label><label className="form-label">Collection <span className="req">Optional</span><input className="form-input" maxLength={500} value={draft.collection} onChange={event => setDraft(current => ({ ...current, collection: event.target.value }))} placeholder="Future scoped availability" /></label><label className="form-label">Taxonomy <span className="req">Optional</span><input className="form-input" maxLength={500} value={draft.taxonomy} onChange={event => setDraft(current => ({ ...current, taxonomy: event.target.value }))} placeholder="Future scoped availability" /></label></div><label className="form-label" style={{ marginTop: 16 }}>Sanitized HTML<textarea className="form-textarea" required rows={10} maxLength={120000} value={draft.html} onChange={event => setDraft(current => ({ ...current, html: event.target.value }))} placeholder={'<section class="prerequisites">\n  <h3>Prerequisites</h3>\n  <ul><li>...</li></ul>\n</section>'} /></label><label style={{ display: "flex", gap: 8, marginTop: 14 }}><input type="checkbox" checked={draft.active} onChange={event => setDraft(current => ({ ...current, active: event.target.checked }))} />Make this snippet available to authoring prompts</label>{draft.html.trim() && <section style={{ marginTop: 16 }}><h3 style={{ fontSize: 14 }}>Sandboxed preview</h3><iframe title="Snippet draft preview" sandbox="" srcDoc={draft.html} style={{ width: "100%", minHeight: 160, border: "1px solid #e0e3e6", borderRadius: 5, background: "white" }} /></section>}<div style={{ display: "flex", gap: 10, marginTop: 22 }}><button className="ds-btn ds-btn-primary" disabled={saving || !connectionId} type="submit">{saving ? "Saving…" : editingId ? "Save changes" : "Create snippet"}</button>{editingId && <button className="ds-btn ds-btn-secondary" type="button" disabled={saving} onClick={reset}>Cancel</button>}</div></form>
  </main>;
}
