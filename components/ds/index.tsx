"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

export function DsDropdown({
  value,
  options,
  onChange,
  placeholder = "Select",
  disabled = false,
}: {
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
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

  return (
    <div className="dsdd" ref={ref}>
      <button
        type="button"
        className="dsdd-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        <span className="dsdd-value">{value || placeholder}</span>
        <span className="ms">{open ? "keyboard_arrow_up" : "keyboard_arrow_down"}</span>
      </button>
      {open && (
        <div className="dsdd-menu" role="listbox">
          {options.map((o) => (
            <div
              key={o}
              className="dsdd-item"
              role="option"
              aria-selected={o === value}
              onClick={() => {
                onChange(o);
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

export function Tooltip({ text, children }: { text: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false);
  return (
    <span
      className="ds-tooltip-wrap"
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {children}
      {visible && (
        <span className="ds-tooltip" role="tooltip">
          {text}
        </span>
      )}
    </span>
  );
}

export interface ToastState {
  message: string;
  icon?: string;
  iconColor?: string;
  borderColor?: string;
}

export function useActionToast(timeoutMs = 3200) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(next: ToastState) {
    if (timer.current) clearTimeout(timer.current);
    setToast(next);
    timer.current = setTimeout(() => setToast(null), timeoutMs);
  }
  function dismiss() {
    if (timer.current) clearTimeout(timer.current);
    setToast(null);
  }

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);
  return [toast, show, dismiss] as const;
}

export function Snackbar({
  icon,
  iconColor,
  borderColor,
  onDismiss,
  children,
}: {
  icon?: string;
  iconColor?: string;
  borderColor?: string;
  onDismiss: () => void;
  children: ReactNode;
}) {
  return (
    <div className="snackbar" role="status" style={borderColor ? { borderLeftColor: borderColor } : undefined}>
      {icon && (
        <span className="ms" style={iconColor ? { color: iconColor } : undefined}>
          {icon}
        </span>
      )}
      <span className="snackbar-text">{children}</span>
      <button type="button" className="icon-btn" title="Dismiss" onClick={onDismiss}>
        <span className="ms">close</span>
      </button>
    </div>
  );
}

/** Shows a solution id with a click-to-copy button; renders a plain "New solution" label when there's no real id yet. */
export function IdChip({ id, copyable = true }: { id: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => (timer.current ? clearTimeout(timer.current) : undefined), []);

  if (!copyable) {
    return <span className="ks-id-chip muted">New solution</span>;
  }

  return (
    <button
      type="button"
      className={"ks-id-chip" + (copied ? " copied" : "")}
      title="Copy solution ID"
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(id);
        } catch {
          // Clipboard API can be unavailable (insecure context, permissions); the id is still visible to copy by hand.
        }
        setCopied(true);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), 1400);
      }}
    >
      <span className="mono">{id}</span>
      <span className="ms">{copied ? "check" : "content_copy"}</span>
    </button>
  );
}

/**
 * Open-question marker. Hidden unless explicitly enabled, so the annotations stay available
 * for design review without leaking into the running product.
 */
export function OQ({ n, children }: { n: string; children: ReactNode }) {
  const on = process.env.NEXT_PUBLIC_SHOW_OQ === "1";
  if (!on) return null;
  return (
    <span className="oq-marker" title={typeof children === "string" ? children : undefined}>
      OQ-{n}
    </span>
  );
}
