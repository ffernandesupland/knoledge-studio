"use client";
import { SourceEditor, type SourceEditorHandle } from "./SourceEditor";
import type { SourceBlock } from "@/lib/ks/source-document";
import { createUploadQueue } from "@/lib/ks/upload-queue";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "@/lib/ingest/limits";

import { Fragment, useEffect, useRef, useState } from "react";
import { KS_STEPS, type StepId } from "@/lib/ks/data";
import type { ToastState } from "@/components/ds";

export function KsStepper({
  activeId,
  doneIds,
  helpers,
  onJump,
}: {
  activeId: StepId;
  doneIds: StepId[];
  helpers?: Partial<Record<StepId, string>>;
  onJump: (id: StepId) => void;
}) {
  return (
    <div className="ks-stepbar">
      {KS_STEPS.map((s, i) => {
        const isActive = s.id === activeId;
        const isDone = doneIds.includes(s.id);
        return (
          <Fragment key={s.id}>
            {i > 0 && <div className="ks-step__div" />}
            <button
              type="button"
              className={"ks-step" + (isActive ? " is-active" : "") + (isDone ? " is-done" : "")}
              onClick={() => onJump(s.id)}
            >
              <span className="ks-step__main">
                <span className="ks-step__gfx">
                  <span className="ms">{isDone ? "check" : s.icon}</span>
                </span>
                <span className="ks-step__text">
                  <span className="ks-step__name">{s.name}</span>
                  <span className="ks-step__helper">{helpers?.[s.id] ?? s.helper}</span>
                </span>
              </span>
            </button>
          </Fragment>
        );
      })}
    </div>
  );
}

/** Wrapping tooltip for the Check table's "Why" column; the DS tooltip is single-line. */
export function KsTipLg({ text, children }: { text: string; children: React.ReactNode }) {
  const [on, setOn] = useState(false);
  return (
    <span className="ks-why-cell" onMouseEnter={() => setOn(true)} onMouseLeave={() => setOn(false)}>
      {children}
      {on && <span className="ks-tip-lg">{text}</span>}
    </span>
  );
}

export function KsAddRuleMenu({
  options,
  onPick,
}: {
  options: string[];
  onPick: (rule: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (!options.length) return null;
  return (
    <div style={{ position: "relative" }} ref={ref}>
      <button
        type="button"
        className="ds-btn ds-btn-secondary"
        style={{ height: 28, padding: "0 10px" }}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="ms" style={{ fontSize: 16 }}>
          add
        </span>
        Add rule
      </button>
      {open && (
        <div className="dsdd-menu" style={{ minWidth: 200 }}>
          {options.map((o) => (
            <div
              key={o}
              className="dsdd-item"
              onClick={() => {
                onPick(o);
                setOpen(false);
              }}
            >
              {o}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export interface Attachment {
  id: string;
  imageId?: string;
  icon: string;
  name: string;
  meta?: string;
  /** Extracted text; this is what the pipeline actually reads. */
  text: string;
}

export interface KbRow {
  id: string;
  title: string;
  meta: string;
}

/**
 * One field doubling as text entry and file-drop target. Locked pattern: no Text/URL/Documents
 * tabs and no formatting toolbar; content types coexist so nothing locks out a second type.
 */
export function KsSmartInput({
  content,
  onContentChange,
  attachments,
  onRemoveAttachment,
  onAttach,
  dragOver,
  onDragOver,
  kbOpen,
  onToggleKb,
  kbQuery,
  onKbQuery,
  kbRows,
  kbLoading,
  kbSelected,
  onToggleKbRow,
  showToast,
  onBusyChange,
}: {
  content: SourceBlock[];
  onContentChange: (v: SourceBlock[]) => void;
  attachments: Attachment[];
  onRemoveAttachment: (i: number) => void;
  onAttach: (a: Attachment) => void;
  dragOver: boolean;
  onDragOver: (v: boolean) => void;
  kbOpen: boolean;
  onToggleKb: () => void;
  kbQuery: string;
  onKbQuery: (v: string) => void;
  kbRows: KbRow[];
  kbLoading: boolean;
  kbSelected: Record<string, KbRow>;
  onToggleKbRow: (id: string) => void;
  showToast: (t: ToastState) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const editor = useRef<SourceEditorHandle>(null);
  const removed = useRef(new Set<string>());
  const kbSearchInput = useRef<HTMLInputElement>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [queue] = useState(() => createUploadQueue());
  const pending = useRef(0);
  const [uploads, setUploads] = useState<{ id: string; name: string; status: string; error?: boolean }[]>([]);

  function enqueue(work: () => Promise<void>) {
    pending.current++;
    setPendingCount(pending.current);
    onBusyChange(true);
    void queue.add(work).catch(error => {
      showToast({ message: error instanceof Error ? error.message : "Unable to read source" });
    }).finally(() => {
      pending.current--;
      setPendingCount(pending.current);
      onBusyChange(pending.current > 0);
    });
  }

  function ingestFiles(files: File[]) {
    onDragOver(false);
    const entries = files.map(file => ({ file, id: crypto.randomUUID() }));
    editor.current?.insert(entries.map(e => e.id));
    for (const { file, id } of entries) {
      if (attachments.length + pending.current >= 20) {
        setUploads(rows => [...rows, { id, name: file.name, status: "Up to 20 attachments per plan. Remove a source and add this file again.", error: true }]);
        continue;
      }
      setUploads(rows => [...rows, { id, name: file.name, status: "Queued" }]);
      enqueue(() => ingestFile(file, id));
    }
  }

  async function ingestFile(file: File, id: string) {
    if (removed.current.has(id)) return;
    setUploads(rows => rows.map(row => row.id === id ? { ...row, status: "Reading…" } : row));
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than the ${MAX_UPLOAD_MB} MB limit`);
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (removed.current.has(id)) return;
      onAttach({
        id, imageId: data.source.imageId,
        icon: data.source.kind === "image" ? "image" : data.source.meta.includes("PDF") ? "picture_as_pdf" : "description",
        name: data.source.label,
        meta: data.source.meta,
        text: data.source.text,
      });
      setUploads(rows => rows.filter(row => row.id !== id));
    } catch (e) {
      setUploads(rows => rows.map(row => row.id === id ? { ...row, status: (e as Error).message, error: true } : row));
    }
  }

  async function ingestUrl(url: string, id: string) {
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      if (removed.current.has(id)) return;
      onAttach({ id, icon: "link", name: data.source.label, meta: data.source.meta, text: data.source.text });
      setUploads(rows => rows.filter(row => row.id !== id));
    } catch (e) {
      setUploads(rows => rows.map(row => row.id === id ? { ...row, status: (e as Error).message, error: true } : row));
    }
  }

  function addUrl(url: string) {
    const id = crypto.randomUUID();
    editor.current?.insert([id]);
    setUploads(rows => [...rows, { id, name: url, status: "Reading…" }]);
    enqueue(() => ingestUrl(url, id));
  }
  function removeSource(id: string) {
    removed.current.add(id);
    const index = attachments.findIndex(a => a.id === id);
    if (index >= 0) onRemoveAttachment(index);
    setUploads(rows => rows.filter(row => row.id !== id));
    onContentChange(content.filter(b => b.type !== "attachment" || b.attachmentId !== id));
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    onDragOver(false);
    ingestFiles(Array.from(e.dataTransfer.files));
  }

  const selectedSolutions = Object.values(kbSelected);
  const kbCount = selectedSolutions.length;
  const availableSolutions = kbRows.filter((row) => !kbSelected[row.id]);

  return (
    <div
      className={"ks-smart-input" + (dragOver ? " dragover" : "")}
      onDragOver={(e) => {
        e.preventDefault();
        onDragOver(true);
      }}
      onDragLeave={() => onDragOver(false)}
      onDrop={handleDrop}
    >
      <SourceEditor ref={editor} blocks={content} onChange={onContentChange} onFiles={ingestFiles} onUrl={addUrl} renderSource={id => {
        const a = attachments.find(a => a.id === id);
        const upload = uploads.find(u => u.id === id);
        return <div className="ks-inline-source" role={upload?.error ? "alert" : undefined}>
          <div className="ks-si-row">
            <span className="ms">{a?.icon ?? (upload?.error ? "error" : "hourglass_top")}</span>
            <div className="ks-si-main"><div className="ks-si-name">{a?.name ?? upload?.name ?? "Uploading…"}</div>
              <div className="ks-si-meta">{a ? `${a.meta ?? "Source"} · Ready` : `${upload?.error ? "Not included: " : ""}${upload?.status ?? "Queued"}`}</div>
            </div>
            <button type="button" className="icon-btn" aria-label={`Remove ${a?.name ?? upload?.name ?? "source"}`} onClick={() => removeSource(id)}><span className="ms">close</span></button>
          </div>
          {a?.icon === "image" && !a.imageId && <p className="ks-si-summary">This older upload contains extracted text only. Reinsert the image to include its original visual content.</p>}
          {/* Original protected images use the signed-in browser session directly. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {a?.imageId ? <img className="ks-source-image" src={`/api/ingest/images/${a.imageId}`} alt={a.name} /> : a && <details className="ks-si-preview"><summary>View document content</summary><div>{a.text}</div></details>}
        </div>;
      }} />
      <div className="ks-si-summary" role="status">
        {attachments.length + (content.some(b => b.type === "text" && b.text.trim()) ? 1 : 0) + kbCount} sources ready{pendingCount > 0 && ` · ${pendingCount} processing`} · Text, images and documents are sent in the order shown.
      </div>
      <div className="ks-si-bar">
        <input
          ref={fileInput}
          type="file"
          hidden
          multiple
          accept=".png,.jpg,.jpeg,.webp,.pdf,.docx,.txt,.md,.csv"
          onChange={(e) => {
            ingestFiles(Array.from(e.target.files ?? []));
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="icon-btn"
          title="Attach files"
          aria-label="Attach files"
          onClick={() => fileInput.current?.click()}
        >
          <span className="ms">attach_file</span>
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Search your knowledge base"
          onClick={onToggleKb}
        >
          <span className="ms">database</span>
        </button>
        <span className="ks-si-help">
          {pendingCount > 0 ? `Reading ${pendingCount} sources. You can add more files while these finish.` : `Select or drop multiple PNG, JPEG, WebP, PDF, Word or text files. ${MAX_UPLOAD_MB} MB each.`}
        </span>
      </div>
      {(kbOpen || kbCount > 0) && (
        <div className="ks-si-kb">
          <div className="ks-kb-search">
            {selectedSolutions.map((solution) => (
              <span className="ks-kb-chip" key={solution.id} title={`${solution.title} · ${solution.id}`}>
                <span className="ms" aria-hidden="true">description</span>
                <span className="ks-kb-chip-title">{solution.title}</span>
                <button
                  type="button"
                  aria-label={`Remove ${solution.title}`}
                  onClick={() => {
                    onToggleKbRow(solution.id);
                    kbSearchInput.current?.focus();
                  }}
                >
                  <span className="ms" aria-hidden="true">close</span>
                </button>
              </span>
            ))}
            <input
              ref={kbSearchInput}
              className="ks-kb-query"
              aria-label="Search your knowledge base"
              placeholder={kbCount ? "Search for another solution…" : "Search your knowledge base…"}
              value={kbQuery}
              onFocus={() => { if (!kbOpen) onToggleKb(); }}
              onChange={(e) => onKbQuery(e.target.value)}
            />
          </div>
          {kbOpen && (
            <div className="ks-si-list ks-kb-results">
              {kbLoading ? (
                <div className="ks-kb-message" role="status">Searching…</div>
              ) : availableSolutions.length === 0 ? (
                <div className="ks-kb-message" role="status">
                  {!kbQuery.trim() ? "Type to search your knowledge base" : kbRows.length ? "All matching solutions are selected" : "No solutions match that search"}
                </div>
              ) : availableSolutions.map((row) => (
                <button
                  type="button"
                  className="ks-si-row ks-kb-result"
                  key={row.id}
                  aria-label={`Select ${row.title}`}
                  onClick={() => {
                    onToggleKbRow(row.id);
                    kbSearchInput.current?.focus();
                  }}
                >
                  <span className="ms" aria-hidden="true">add</span>
                  <span className="ks-si-main">
                    <span className="ks-si-name">{row.title}</span>
                    <span className="ks-si-meta">{row.meta}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className="ks-kb-count" role="status">{kbCount} selected</div>
        </div>
      )}
      <div className="ks-si-overlay">
        <span className="ms">cloud_upload</span>
        <span>Drop to attach</span>
      </div>
    </div>
  );
}
