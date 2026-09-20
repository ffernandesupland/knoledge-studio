"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";

type Connection = { id: string; name: string; baseUrl: string; user: string; isDefault: boolean; managedByEnvironment?: boolean };
const blank = { name: "", baseUrl: "", bearerToken: "", user: "", makeDefault: false };

export default function RightAnswersConnections() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const load = useCallback(async () => {
    const response = await fetch("/api/ra-connections");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setConnections(data.connections);
  }, []);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/ra-connections").then(async response => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      if (!cancelled) setConnections(data.connections);
    }).catch((error: Error) => { if (!cancelled) setMessage(error.message); });
    return () => { cancelled = true; };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/ra-connections", { method: editing ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(editing ? { id: editing.id, name: form.name, baseUrl: form.baseUrl, bearerToken: form.bearerToken, user: form.user } : form) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setEditing(null); setForm(blank); setMessage(editing ? "Customer updated." : "Customer added."); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save customer."); }
    finally { setBusy(false); }
  }
  async function makeDefault(id: string) {
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/ra-connections", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, makeDefault: true }) }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await load(); setMessage("Default customer updated."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not change the default."); }
    finally { setBusy(false); }
  }
  async function testConnection() {
    setTesting(true); setMessage("");
    try {
      const response = await fetch("/api/ra-connections/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: editing?.id, baseUrl: form.baseUrl, bearerToken: form.bearerToken, user: form.user }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage(`Connection successful. RightAnswers returned ${data.templateCount} article template${data.templateCount === 1 ? "" : "s"}.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not connect to RightAnswers."); }
    finally { setTesting(false); }
  }
  async function remove(item: Connection) {
    if (!window.confirm(`Delete ${item.name}?`)) return;
    setBusy(true); setMessage("");
    try { const response = await fetch("/api/ra-connections?id=" + encodeURIComponent(item.id), { method: "DELETE" }); const data = await response.json(); if (!response.ok) throw new Error(data.error); await load(); setMessage("Customer deleted."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not delete customer."); }
    finally { setBusy(false); }
  }
  function edit(item: Connection) { setEditing(item); setForm({ name: item.name, baseUrl: item.baseUrl, user: item.user, bearerToken: "", makeDefault: false }); setMessage(""); }

  return <main style={{ padding: "34px", maxWidth: 1120, margin: "0 auto" }}>
    <p style={{ color: "#2574db", fontWeight: 700, fontSize: 12, textTransform: "uppercase" }}>Platform settings</p>
    <h1 style={{ margin: "4px 0 8px" }}>RightAnswers customers</h1>
    <p style={{ color: "#6b7786", maxWidth: 720 }}>Register the customer environments available to Knowledge Studio and choose which one appears by default in step 1. Bearer tokens are encrypted and are never shown again after saving.</p>
    {message && <p className="ks-card" role="status" style={{ padding: 14 }}>{message}</p>}
    <section className="ks-card" style={{ padding: 22, marginTop: 24 }}>
      <h2 style={{ marginTop: 0 }}>Available customers</h2>
      <div style={{ display: "grid", gap: 12 }}>{connections.map(item => <article key={item.id} style={{ display: "flex", alignItems: "center", gap: 16, border: "1px solid #e0e3e6", borderRadius: 8, padding: 16 }}>
        <span className="ms" style={{ color: "#2574db", fontSize: 28 }}>dns</span>
        <div style={{ minWidth: 0, flex: 1 }}><strong>{item.name}</strong>{item.isDefault && <span className="ks-tag ks-tag-new" style={{ marginLeft: 10 }}>Default</span>}<div style={{ color: "#6b7786", fontSize: 12, overflowWrap: "anywhere", marginTop: 4 }}>{item.baseUrl} · {item.user}</div></div>
        {!item.isDefault && <button className="ds-btn ds-btn-secondary" type="button" disabled={busy} onClick={() => makeDefault(item.id)}>Set default</button>}
        {!item.managedByEnvironment && <><button className="ds-btn ds-btn-secondary" type="button" disabled={busy} onClick={() => edit(item)}>Edit</button><button className="icon-btn" aria-label={`Delete ${item.name}`} type="button" disabled={busy} onClick={() => remove(item)}><span className="ms">delete</span></button></>}
      </article>)}</div>
    </section>
    <form className="ks-card" onSubmit={save} style={{ padding: 22, marginTop: 20 }}>
      <h2 style={{ marginTop: 0 }}>{editing ? `Edit ${editing.name}` : "Add customer"}</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 16 }}>
        <label className="form-label">Customer name<input className="form-input" required maxLength={120} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} /></label>
        <label className="form-label">RightAnswers URL<input className="form-input" required type="url" placeholder="https://customer.rightanswers.com/portal" value={form.baseUrl} onChange={event => setForm({ ...form, baseUrl: event.target.value })} /></label>
        <label className="form-label">User<input className="form-input" required maxLength={200} value={form.user} onChange={event => setForm({ ...form, user: event.target.value })} /></label>
        <label className="form-label">Bearer token<input className="form-input" required={!editing} type="password" autoComplete="new-password" placeholder={editing ? "Leave blank to keep current token" : "Paste bearer token"} value={form.bearerToken} onChange={event => setForm({ ...form, bearerToken: event.target.value })} /></label>
      </div>
      {!editing && <label style={{ display: "flex", gap: 8, marginTop: 18 }}><input type="checkbox" checked={form.makeDefault} onChange={event => setForm({ ...form, makeDefault: event.target.checked })} />Use as default customer</label>}
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button className="ds-btn ds-btn-secondary" disabled={busy || testing || !form.baseUrl.trim() || !form.user.trim() || (!editing && !form.bearerToken.trim())} type="button" onClick={testConnection}>
          <span className="ms" style={{ fontSize: 18 }}>{testing ? "progress_activity" : "wifi_tethering"}</span>
          {testing ? "Testing…" : "Test connection"}
        </button>
        <button className="ds-btn ds-btn-primary" disabled={busy || testing} type="submit">{busy ? "Saving…" : editing ? "Save changes" : "Add customer"}</button>
        {editing && <button className="ds-btn ds-btn-secondary" disabled={busy || testing} type="button" onClick={() => { setEditing(null); setForm(blank); }}>Cancel</button>}
      </div>
    </form>
  </main>;
}
