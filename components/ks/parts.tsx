"use client";
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
  text,
  onTextChange,
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
}: {
  text: string;
  onTextChange: (v: string) => void;
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
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const kbSearchInput = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function ingestFile(file: File) {
    setBusy(`Reading ${file.name}…`);
    try {
      if (file.size > MAX_UPLOAD_BYTES) throw new Error(`${file.name} is larger than the ${MAX_UPLOAD_MB} MB limit`);
      const body = new FormData();
      body.append("file", file);
      const res = await fetch("/api/ingest", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAttach({
        icon: data.source.meta.includes("PDF") ? "picture_as_pdf" : "description",
        name: data.source.label,
        meta: data.source.meta,
        text: data.source.text,
      });
      showToast({ message: `Added ${data.source.label}` });
    } catch (e) {
      showToast({ message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  async function ingestUrl(url: string) {
    setBusy("Fetching link…");
    try {
      const res = await fetch("/api/ingest", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      onAttach({ icon: "link", name: data.source.label, meta: data.source.meta, text: data.source.text });
      showToast({ message: "Link added" });
    } catch (e) {
      showToast({ message: (e as Error).message });
    } finally {
      setBusy(null);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const pasted = e.clipboardData.getData("text");
    if (pasted && /^https?:\/\/\S+$/i.test(pasted.trim())) {
      e.preventDefault();
      void ingestUrl(pasted.trim());
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    onDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) void ingestFile(file);
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
      <textarea
        className="ks-si-textarea"
        placeholder="Type, paste a link, or drop a file…"
        value={text}
        onChange={(e) => onTextChange(e.target.value)}
        onPaste={handlePaste}
      />
      {attachments.length > 0 && (
        <div className="ks-si-list">
          {attachments.map((a, i) => (
            <div className="ks-si-row" key={`${a.name}-${i}`}>
              <span className="ms">{a.icon}</span>
              <div className="ks-si-main">
                <div className="ks-si-name">{a.name}</div>
                {a.meta && <div className="ks-si-meta">{a.meta}</div>}
              </div>
              <button
                type="button"
                className="icon-btn"
                title="Remove"
                onClick={() => onRemoveAttachment(i)}
              >
                <span className="ms">close</span>
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="ks-si-bar">
        <input
          ref={fileInput}
          type="file"
          hidden
          accept=".pdf,.docx,.txt,.md,.csv"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void ingestFile(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          className="icon-btn"
          title="Attach a file"
          disabled={!!busy}
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
          {busy ?? "Type, paste a link, or drop a PDF, Word or text file."}
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
