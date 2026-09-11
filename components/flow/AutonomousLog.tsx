"use client";
import { useEffect, useRef, useState } from "react";
import type { AutonomousEvent } from "@/lib/autonomous/types";

/** Paginated summaries stay small. Exact model/tool payloads load only when inspected. */
export function AutonomousLog({ runId, live = false }: { runId: string; live?: boolean }) {
  const [items, setItems] = useState<AutonomousEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const [detail, setDetail] = useState<AutonomousEvent | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const cursor = useRef(0);
  const detailRequest = useRef<AbortController | null>(null);
  useEffect(() => () => detailRequest.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function read() {
      try {
        const response = await fetch(`/api/autonomous/events?runId=${encodeURIComponent(runId)}&after=${cursor.current}`, { signal: controller.signal });
        const page = await response.json();
        if (!response.ok) throw new Error(page.error);
        if (controller.signal.aborted) return;
        if (page.events.length) {
          cursor.current = page.events.at(-1).id;
          setItems(prev => [...prev, ...page.events]);
        }
        setHasMore(page.hasMore); setError("");
        // Do not flood the browser with a large historical run; Load more handles backlog.
        if (live && !page.hasMore) timer = setTimeout(read, 4000);
      } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "Could not load activity"); if (live) timer = setTimeout(read, 5000); } }
    }
    void read();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, live, revision]);
  async function inspect(id: number) {
    detailRequest.current?.abort();
    const controller = new AbortController(); detailRequest.current = controller;
    setLoadingDetail(true); setDetail(null);
    try {
      const response = await fetch(`/api/autonomous/events?runId=${encodeURIComponent(runId)}&eventId=${id}`, { signal: controller.signal });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      if (!controller.signal.aborted) setDetail(data);
    } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load event"); }
    finally { if (!controller.signal.aborted) setLoadingDetail(false); }
  }
  return <section className="auto-log" aria-label="Autonomous decisions and activity">
    <h2>Agent decisions and activity</h2>
    <p>Recorded decisions include explanations and evidence. Inspect a call to see its exact input or output; matching call IDs connect requests with their results.</p>
    {error && <p role="alert">{error}</p>}
    <div className="auto-log-layout"><div className="auto-events"><ol>{items.map(item => <li key={item.id}>
      <button type="button" onClick={() => inspect(item.id)} aria-pressed={detail?.id === item.id}>
        <small>{new Date(item.at).toLocaleTimeString()} · {item.stage} · {item.kind} · {item.status}</small>
        <strong>{item.name}</strong>{item.explanation && <span>{item.explanation}</span>}
      </button>
    </li>)}</ol>{items.length === 0 && <p>Waiting for the first recorded event…</p>}
    <button type="button" className="ds-btn ds-btn-secondary" onClick={() => setRevision(n => n + 1)}>{hasMore ? "Load more activity" : "Refresh activity"}</button></div>
    <aside className="auto-event-detail" aria-live="polite"><h3>{loadingDetail ? "Loading event…" : detail?.name ?? "Inspect an event"}</h3>
      {detail && <><p>{detail.explanation}</p><small>Event {detail.id}{detail.correlationId ? ` · Call ${detail.correlationId}` : ""}</small>
        {detail.input !== undefined && <details open><summary>Recorded input</summary><pre>{JSON.stringify(detail.input, null, 2)}</pre></details>}
        {detail.output !== undefined && <details open><summary>Recorded output</summary><pre>{JSON.stringify(detail.output, null, 2)}</pre></details>}
      </>}
    </aside></div>
  </section>;
}
