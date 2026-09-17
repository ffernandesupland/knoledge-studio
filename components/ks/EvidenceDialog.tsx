"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import styles from "./MetadataReview.module.css";

export function EvidenceDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => element?.close(); }, []);
  return createPortal(<dialog ref={dialog} aria-labelledby={heading} className={styles.dialog} onCancel={onClose} onClose={event => { if (!event.currentTarget.open) onClose(); }}>
    <header><div><span className={styles.eyebrow}>Evidence and decisions</span><h2 id={heading}>{title}</h2></div><button type="button" onClick={onClose} aria-label="Close evidence">Close ×</button></header>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>, document.body);
}
