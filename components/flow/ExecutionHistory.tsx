"use client";
import { AutonomousLog } from "./AutonomousLog";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { ExecutedFlow, ExecutedNode, PastExecution } from "@/lib/flow/executions";
import { SubmissionGraph } from "../ks/SubmissionGraph";
import { AutonomousOutcome } from "../ks/AutonomousOutcome";
import { mermaidTree } from "@/lib/flow/model";

export function ExecutionHistory({ initialRunId, onModeChange }: { initialRunId?: string; onModeChange: (executed: boolean) => void }) {
  const [runId, setRunId] = useState(initialRunId ?? "");
  const [offset, setOffset] = useState(0);
  const [history, setHistory] = useState<{ runs: PastExecution[]; hasMore: boolean } | null>(null);
  const [flow, setFlow] = useState<ExecutedFlow | null>(null);
  const [selected, setSelected] = useState<ExecutedNode | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/runs/executions?offset=${offset}`, { signal: controller.signal }).then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setHistory(data); }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [offset, refresh]);
  useEffect(() => {
    if (!runId) return;
    const controller = new AbortController();
    fetch(`/api/runs/executions?runId=${encodeURIComponent(runId)}`, { signal: controller.signal }).then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setFlow(data); setSelected(null); setError(""); }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [runId, refresh]);
  function open(id: string) { setFlow(null); setError(""); setRunId(id); setSelected(null); setRefresh((n) => n + 1); onModeChange(true); }
  const diagram = flow ? mermaidTree(flow.tree) : "";
  function nodes(items: ExecutedNode[], root = false) {
    return <ul className={root ? "flow-tree-root" : "flow-branches"}>{items.map((n) => <li key={n.id}>
      <button className={`flow-node flow-kind-${n.kind} ${selected?.id === n.id ? "flow-selected" : ""}`} onClick={() => setSelected(n)} aria-pressed={selected?.id === n.id}>
        <span className="flow-node-meta">Recorded {n.kind === "ai" ? "AI call" : "stage"}</span><strong>{n.title}</strong><span className="flow-node-detail">{n.detail}</span>
        {n.record != null && <span className="flow-prompt-link">Inspect saved record ↗</span>}
      </button>{n.children?.length ? nodes(n.children) : null}
    </li>)}</ul>;
  }
  return <section className="flow-history">
    <details open={!runId}><summary>Past executions</summary>
      <p>Saved runs for your account. Opening a record makes no AI calls and does not repeat writes.</p>
      <div className="flow-history-table"><table><thead><tr><th>Started</th><th>Run</th><th>Status</th><th>AI cost</th><th>Flow</th></tr></thead><tbody>
        {history?.runs.map((r) => <tr key={r.id}><td>{new Date(r.createdAt).toLocaleString()}</td><td>{r.title}<small>{r.id}</small></td><td>{r.status}</td><td>${r.costUsd.toFixed(4)}</td><td><button onClick={() => open(r.id)}>Open executed flow</button></td></tr>)}
      </tbody></table></div>
      {history?.runs.length === 0 && <p>No completed analyses or submissions recorded yet.</p>}
      <div className="flow-header-actions"><button disabled={offset === 0} onClick={() => { setHistory(null); setOffset((n) => Math.max(0, n - 20)); }}>Newer</button><button disabled={!history?.hasMore} onClick={() => { setHistory(null); setOffset((n) => n + 20); }}>Older</button></div>
    </details>
    {error && <p role="alert">{error}</p>}
    {runId && <>
      <div className="flow-execution-heading"><div><h2>Executed engine flow</h2><p>{flow?.title ?? "Loading saved execution…"}</p><small>{runId}</small></div>
        <div className="flow-header-actions"><button onClick={() => { setError(""); setRefresh((n) => n + 1); }}>Refresh saved activity</button><button onClick={() => { setRunId(""); setFlow(null); onModeChange(false); }}>Explore a hypothetical scenario</button></div>
      </div>
      {flow && <>
        <p><strong>{flow.status}</strong> · ${flow.costUsd.toFixed(4)} recorded AI cost · Saved {new Date(flow.savedAt).toLocaleString()} · <Link href={`/flow?view=executed&runId=${encodeURIComponent(flow.runId)}`}>Permanent link</Link></p>
        {flow.outcome && <AutonomousOutcome outcome={flow.outcome} error={flow.error} showProposals={!flow.graph?.rows.length && ["error", "partial"].includes(flow.status)} />}
        {!!flow.graph?.rows.length && <SubmissionGraph model={flow.graph} runId={flow.runId} mode="history" decisionActor={flow.mode === "autonomous" ? "agent" : "author"} />}
        {flow.mode === "autonomous" && <><p><Link href={`/?autonomousRun=${encodeURIComponent(flow.runId)}`}>{["submitted", "partial", "error"].includes(flow.status) ? "Open final result" : "Open autonomous run status"}</Link></p><AutonomousLog key={flow.runId} runId={flow.runId} live={!["submitted", "partial", "error"].includes(flow.status)} /></>}
        <p>This tree contains recorded activity and choices. Missing records are identified explicitly. Prompt nodes show the exact saved requests and responses, including the model and prompt version used at that time.</p>
        <button onClick={() => { const url = URL.createObjectURL(new Blob([diagram], { type: "text/plain" })); const a = document.createElement("a"); a.href = url; a.download = `${flow.runId}-executed.mmd`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download executed Mermaid tree</button>
        <div className="flow-executed-layout"><section aria-label="Executed engine flow">{nodes(flow.tree, true)}</section><aside className="flow-inspector"><h2>{selected?.title ?? "Inspect recorded activity"}</h2><p>{selected?.detail ?? "Select a stage, AI call or write outcome to see its saved data."}</p>
          {selected?.record != null && <pre>{JSON.stringify(selected.record, null, 2)}</pre>}
          <details><summary>Executed Mermaid source</summary><pre>{diagram}</pre></details>
        </aside></div>
      </>}
    </>}
  </section>;
}
