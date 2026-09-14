"use client";
import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type ReactNode } from "react";
import { insertSources, type SourceBlock } from "@/lib/ks/source-document";
export interface SourceEditorHandle { insert: (ids: string[]) => void }

export const SourceEditor = forwardRef<SourceEditorHandle, {
  blocks: SourceBlock[];
  onChange: (blocks: SourceBlock[]) => void;
  onFiles: (files: File[]) => void;
  onUrl: (url: string) => void;
  renderSource: (id: string) => ReactNode;
}>(function SourceEditor({ blocks, onChange, onFiles, onUrl, renderSource }, ref) {
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(blocks);
  latest.current = blocks;
  const cursor = useRef<{ id: string; start: number; end: number } | null>(null);
  const focusNext = useRef<string | null>(null);
  function change(next: SourceBlock[]) { latest.current = next; onChange(next); }
  function remember(el: HTMLTextAreaElement, id: string) { cursor.current = { id, start: el.selectionStart, end: el.selectionEnd }; }
  useImperativeHandle(ref, () => ({ insert(ids) {
    if (!ids.length) return;
    const fallback = latest.current.findLast(b => b.type === "text");
    if (!fallback || fallback.type !== "text") return;
    const selection = cursor.current && latest.current.some(b => b.id === cursor.current!.id) ? cursor.current : { id: fallback.id, start: fallback.text.length, end: fallback.text.length };
    const next = insertSources(latest.current, selection.id, selection.start, selection.end, ids, () => crypto.randomUUID());
    const last = next.findIndex(b => b.type === "attachment" && b.attachmentId === ids[ids.length - 1]);
    const trailing = next[last + 1];
    focusNext.current = trailing.id;
    cursor.current = { id: trailing.id, start: 0, end: 0 };
    change(next);
  }}));
  useLayoutEffect(() => {
    for (const el of root.current?.querySelectorAll("textarea") ?? []) {
      el.style.height = "auto";
      el.style.height = `${Math.max(el.scrollHeight, 44)}px`;
      if (el.dataset.blockId === focusNext.current) { el.focus(); el.setSelectionRange(0, 0); focusNext.current = null; }
    }
  }, [blocks]);
  return <div ref={root} className="ks-source-editor" role="group" aria-label="Content editor">
    {blocks.map((block, index) => block.type === "attachment"
      ? <div className="ks-editor-source" key={block.id} data-source-id={block.attachmentId}>{renderSource(block.attachmentId)}</div>
      : <textarea key={block.id} data-block-id={block.id} className="ks-editor-text" rows={1}
          aria-label={index === 0 ? "Source text" : `Source text ${index + 1}`}
          placeholder={index === 0 ? "Write or paste text. Insert images and files at your cursor…" : "Continue writing here…"}
          value={block.text}
          onSelect={e => remember(e.currentTarget, block.id)}
          onBlur={e => remember(e.currentTarget, block.id)}
          onFocus={e => remember(e.currentTarget, block.id)}
          onChange={e => { remember(e.currentTarget, block.id); change(latest.current.map(b => b.id === block.id ? { ...block, text: e.target.value } : b)); }}
          onPaste={e => {
            remember(e.currentTarget, block.id);
            const files = Array.from(e.clipboardData.files);
            if (files.length) { e.preventDefault(); onFiles(files); return; }
            const pasted = e.clipboardData.getData("text");
            if (/^https?:\/\/\S+$/i.test(pasted.trim())) { e.preventDefault(); onUrl(pasted.trim()); }
          }}
          onDrop={e => { if (e.dataTransfer.files.length) { e.preventDefault(); e.stopPropagation(); remember(e.currentTarget, block.id); onFiles(Array.from(e.dataTransfer.files)); } }}
        />)}
  </div>;
});
