"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import styles from "./AIWorkspace.module.css";

type Connection = { id: string; name: string; baseUrl: string; isDefault: boolean };
type Thread = { id: string; title: string; connectionId: string; updatedAt: string };
type ContextItem = { id: string; solutionId: string; title: string; role: "reference" | "target" | "standard"; snapshot: { status: string } };
type Attachment = { id?: string; label: string; text: string; kind: "pdf" | "docx" | "text" | "image"; imageId?: string; fileId?: string; meta: string };
type Message = { id: string; role: string; content: string; html?: string; attachments: Attachment[] };
type ThreadDetail = { thread: Thread; contextItems: ContextItem[]; messages: Message[] };
type SearchRow = { id: string; title: string; meta: string; status?: string };

async function json<T>(response: Response): Promise<T> {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "Request failed");
  return value;
}

export default function AIWorkspace() {
  const [connections, setConnections] = useState<Connection[]>([]);
  const [newConnectionId, setNewConnectionId] = useState("");
  const [threads, setThreads] = useState<Thread[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [solutionId, setSolutionId] = useState("");
  const [solutionQuery, setSolutionQuery] = useState("");
  const [solutionRows, setSolutionRows] = useState<SearchRow[]>([]);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [role, setRole] = useState<ContextItem["role"]>("reference");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  const loadThreads = useCallback(async () => {
    const result = await json<{ threads: Thread[] }>(await fetch("/api/agent/threads"));
    setThreads(result.threads);
    setSelectedId((current) => current || result.threads[0]?.id || "");
  }, []);

  useEffect(() => {
    fetch("/api/ra-connections").then(json<{ connections: Connection[] }>).then((result) => {
      setConnections(result.connections);
      setNewConnectionId((current) => current || result.connections.find((connection) => connection.isDefault)?.id || result.connections[0]?.id || "");
    }).catch((error: Error) => setNotice(error.message));
    fetch("/api/agent/threads").then(json<{ threads: Thread[] }>).then((result) => {
      setThreads(result.threads);
      setSelectedId((current) => current || result.threads[0]?.id || "");
    }).catch((error: Error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    const controller = new AbortController();
    fetch(`/api/agent/threads/${encodeURIComponent(selectedId)}`, { signal: controller.signal })
      .then(json<ThreadDetail>).then(setDetail).catch((error: Error) => { if (error.name !== "AbortError") setNotice(error.message); });
    return () => controller.abort();
  }, [selectedId]);

  useEffect(() => {
    if (!detail || solutionQuery.trim().length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch(`/api/kb/search?q=${encodeURIComponent(solutionQuery.trim())}&connectionId=${encodeURIComponent(detail.thread.connectionId)}`, { signal: controller.signal })
        .then(json<{ rows: SearchRow[] }>).then((result) => setSolutionRows(result.rows)).catch((error: Error) => { if (error.name !== "AbortError") setNotice(error.message); });
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [detail, solutionQuery]);

  async function newWorkspace() {
    setBusy(true); setNotice("");
    try {
      const selected = connections.find((connection) => connection.id === newConnectionId) ?? connections.find((connection) => connection.isDefault) ?? connections[0];
      if (!selected) throw new Error("Create a RightAnswers customer connection first.");
      const result = await json<{ thread: Thread }>(await fetch("/api/agent/threads", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ connectionId: selected.id }) }));
      await loadThreads(); setSelectedId(result.thread.id);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to create workspace"); }
    finally { setBusy(false); }
  }

  async function addSolution(event: FormEvent) {
    event.preventDefault(); if (!selectedId) return;
    setBusy(true); setNotice("");
    try {
      const requested = solutionId || (/^\d{15}$/.test(solutionQuery.trim()) ? solutionQuery.trim() : "");
      if (!requested) throw new Error("Search for a solution title and select it, or enter its 15-digit ID.");
      await json(await fetch(`/api/agent/threads/${encodeURIComponent(selectedId)}/context`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ solutionId: requested, role }) }));
      setSolutionId(""); setSolutionQuery(""); setSolutionRows([]);
      const loaded = await json<ThreadDetail>(await fetch(`/api/agent/threads/${encodeURIComponent(selectedId)}`)); setDetail(loaded);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to add solution"); }
    finally { setBusy(false); }
  }

  async function addFiles(files: File[]) {
    if (!files.length) return;
    if (attachments.length + files.length > 4) { setNotice("Attach at most four files per message."); return; }
    setBusy(true); setNotice("");
    try {
      const uploaded = await Promise.all(files.map(async (file) => {
        const data = new FormData(); data.append("file", file); data.append("mode", "agent");
        const result = await json<{ source: Attachment; sources?: Attachment[] }>(await fetch("/api/ingest", { method: "POST", body: data }));
        return result.sources ?? [result.source];
      }));
      const flattened = uploaded.flat();
      if (attachments.length + flattened.length > 4) throw new Error("This document expands to more than four visual attachments. Upload a smaller document or a page range.");
      setAttachments((current) => [...current, ...flattened]);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to attach file"); }
    finally { setBusy(false); }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault(); if (!selectedId || (!message.trim() && !attachments.length)) return;
    const content = message.trim() || "Review the attached material and tell me what you find."; const sentAttachments = attachments; setMessage(""); setAttachments([]); setBusy(true); setNotice("");
    try {
      const response = await fetch(`/api/agent/threads/${encodeURIComponent(selectedId)}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content, attachments: sentAttachments }),
      });
      const result = await json<{ userMessage: ThreadDetail["messages"][number]; assistantMessage: ThreadDetail["messages"][number] }>(response);
      setDetail((current) => current ? { ...current, messages: [...current.messages, result.userMessage, result.assistantMessage] } : current);
      await loadThreads();
    } catch (error) { setMessage(content); setAttachments(sentAttachments); setNotice(error instanceof Error ? error.message : "Unable to send message"); }
    finally { setBusy(false); }
  }

  const selectedConnection = connections.find((connection) => connection.id === detail?.thread.connectionId);
  return <main className={styles.page}>
    <header className={styles.header}>
      <div><p className={styles.eyebrow}>NEW PILOT</p><h1>AI Workspace</h1><p>Bring a task, the right customer context, and selected KB evidence into one governed workspace.</p></div>
      <div className={styles.newWorkspaceControls}><label>Customer<select value={newConnectionId} onChange={(event) => setNewConnectionId(event.target.value)} aria-label="Customer for new workspace">{connections.map((connection) => <option key={connection.id} value={connection.id}>{connection.name}{connection.isDefault ? " (default)" : ""}</option>)}</select></label><button className={styles.primary} onClick={newWorkspace} disabled={busy}><span className="ms">add</span> New workspace</button></div>
    </header>
    {notice && <div className={styles.notice} role="alert">{notice}</div>}
    <section className={styles.workspace}>
      <aside className={styles.threads} aria-label="AI workspaces">
        <div className={styles.panelTitle}>WORKSPACES</div>
        {threads.length ? threads.map((thread) => <button key={thread.id} className={thread.id === selectedId ? styles.threadActive : styles.thread} onClick={() => setSelectedId(thread.id)}><span className="ms">forum</span><span>{thread.title}</span></button>) : <p className={styles.empty}>Start a workspace for a customer and task.</p>}
      </aside>
      <section className={styles.conversation}>
        {detail ? <>
          <div className={styles.conversationHeader}><div><p className={styles.eyebrow}>CUSTOMER CONNECTION</p><h2>{selectedConnection?.name ?? "Loading customer…"}</h2><small>{selectedConnection?.baseUrl}</small></div><span className={styles.readOnly}><span className="ms">lock</span> Read-only pilot</span></div>
          <div className={styles.messageList} aria-live="polite">
            {detail.messages.length ? detail.messages.map((item) => <article key={item.id} className={item.role === "assistant" ? styles.assistantMessage : styles.userMessage}><span>{item.role === "assistant" ? "AI Workspace" : "You"}</span>{item.role === "assistant" && item.html ? <div className={styles.markdown} dangerouslySetInnerHTML={{ __html: item.html }} /> : <p>{item.content}</p>}{item.attachments.length > 0 && <div className={styles.attachmentChips}>{item.attachments.map((attachment, index) => <span key={`${attachment.label}-${index}`}><span className="ms">{attachment.kind === "image" ? "image" : "attach_file"}</span>{attachment.label}</span>)}</div>}</article>) : <div className={styles.emptyConversation}><span className="ms">smart_toy</span><h3>Start with a KB task</h3><p>Ask the workspace to investigate, compare, improve, or propose content. It can read the selected customer’s KB, but it cannot write directly to it.</p></div>}
          </div>
          <form className={styles.composer} onSubmit={sendMessage} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); void addFiles(Array.from(event.dataTransfer.files)); }}><input ref={fileInput} type="file" multiple accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp" className={styles.fileInput} onChange={(event) => { void addFiles(Array.from(event.target.files ?? [])); event.currentTarget.value = ""; }} /><button type="button" className={styles.attachButton} onClick={() => fileInput.current?.click()} disabled={busy} aria-label="Attach image or document"><span className="ms">attach_file</span></button><div className={styles.composerInput}>{attachments.length > 0 && <div className={styles.pendingAttachments}>{attachments.map((attachment, index) => <span key={`${attachment.label}-${index}`}>{attachment.label}<button type="button" onClick={() => setAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index))} aria-label={`Remove ${attachment.label}`}>×</button></span>)}</div>}<textarea value={message} onChange={(event) => setMessage(event.target.value)} maxLength={12000} placeholder="Ask about this customer's knowledge base…" aria-label="Message to AI Workspace" /></div><button className={styles.primary} disabled={busy || (!message.trim() && !attachments.length)}>{busy ? "Working…" : "Send"}<span className="ms">arrow_upward</span></button></form>
        </> : <div className={styles.emptyConversation}><span className="ms">forum</span><h2>Create a workspace to begin</h2><p>The default RightAnswers customer is preselected, and can be changed when creating the next workspace.</p></div>}
      </section>
      <aside className={styles.context} aria-label="KB context">
        <div className={styles.panelTitle}>KB CONTEXT</div>
        {detail ? <>
          <p className={styles.helper}>Pin solutions as evidence, a content target, or an approved standard. They stay tied to this customer.</p>
          <form onSubmit={addSolution} className={styles.contextForm}>
            <div className={styles.solutionSearch}><input value={solutionQuery} onChange={(event) => { setSolutionQuery(event.target.value); setSolutionId(""); }} placeholder="Search title or 15-digit ID" aria-label="Search RightAnswers solutions" />{solutionQuery.trim().length >= 2 && solutionRows.length > 0 && <div className={styles.searchResults}>{solutionRows.map((row) => <button type="button" key={row.id} onClick={() => { setSolutionId(row.id); setSolutionQuery(row.title); setSolutionRows([]); }}><b>{row.title}</b><small>{row.id} · {row.meta}</small></button>)}</div>}</div>
            <select value={role} onChange={(event) => setRole(event.target.value as ContextItem["role"])} aria-label="Context role"><option value="reference">Reference</option><option value="target">Target</option><option value="standard">Standard</option></select>
            <button className={styles.secondary} disabled={busy}>Add solution</button>
          </form>
          <div className={styles.contextList}>{detail.contextItems.length ? detail.contextItems.map((item) => <article key={item.id} className={styles.contextItem}><span className="ms">article</span><div><b>{item.title}</b><small>{item.role} · {item.solutionId} · {item.snapshot.status}</small></div></article>) : <p className={styles.empty}>No KB solutions pinned yet.</p>}</div>
        </> : <p className={styles.empty}>Select a workspace to add context.</p>}
      </aside>
    </section>
  </main>;
}
