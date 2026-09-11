"use client";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { ExecutionHistory } from "./ExecutionHistory";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { PromptExample } from "@/lib/flow/catalog";
import { buildFlow, DEFAULT_FLOW, effectiveNodes, mermaidTree, type FlowNode, type FlowOptions } from "@/lib/flow/model";

const options = [["split", "Split topics"], ["restructure", "Restructure content"], ["standards", "Apply content standards"], ["dedupe", "Find duplicates"], ["optimize", "Optimize for search"], ["gaps", "Find gaps"]] as const;
const kinds = { input: "Source", ai: "AI prompt", api: "API / parser", logic: "Code", human: "Your decision", write: "KB write", stop: "Wait / stop" };

export function FlowExplorer({ catalog, initial, runId, executed = false }: { executed?: boolean; catalog: PromptExample[]; initial: FlowOptions; runId?: string }) {
  const [executionMode, setExecutionMode] = useState(executed && !!runId);
  const [settings, setSettings] = useState(initial);
  const [onlyActive, setOnlyActive] = useState(false);
  const [selected, setSelected] = useState<FlowNode | null>(null);
  const [sample, setSample] = useState("To reset your VPN profile, open Settings, remove the expired profile and import the replacement supplied by IT. Keep your existing certificate.");
  const [trace, setTrace] = useState<{ status: string; costUsd: number; calls: { id: number; phase: string; operation: string; model: string; inputTokens: number; outputTokens: number; costUsd: number; request: string; response: string }[] } | null>(null);
  const [notice, setNotice] = useState("");
  const tree = useMemo(() => effectiveNodes(buildFlow(settings)), [settings]);
  const diagram = useMemo(() => mermaidTree(tree), [tree]);
  const flattened: FlowNode[] = [];
  const flatten = (items: FlowNode[]) => { for (const n of items) { flattened.push(n); if (n.children) flatten(n.children); } };
  flatten(tree);
  const current = flattened.find((n) => n.id === selected?.id) ?? selected;
  const prompt = catalog.find((p) => p.id === current?.prompt);
  const activePrompts = [...new Set(flattened.filter((n) => n.active && n.prompt).map((n) => n.prompt))];
  function update<K extends keyof FlowOptions>(key: K, value: FlowOptions[K]) { setSettings((s) => ({ ...s, [key]: value })); }
  function nodes(items: FlowNode[], top = false) {
    return <ul className={top ? "flow-tree-root" : "flow-branches"}>{items.filter((n) => !onlyActive || n.active).map((node) => <li key={node.id} className={node.active ? "flow-active" : "flow-inactive"}>
      <button className={`flow-node flow-kind-${node.kind} ${current?.id === node.id ? "flow-selected" : ""}`} onClick={() => setSelected(node)} aria-pressed={current?.id === node.id}>
        <span className="flow-node-meta"><span>{kinds[node.kind]}</span><span>{node.active ? "On this path" : "Other path"}</span></span>
        <strong>{node.title}</strong><span className="flow-node-detail">{node.detail}</span>
        {node.prompt && <span className="flow-prompt-link">Inspect {node.prompt} ↗</span>}
      </button>
      {!!node.children?.length && nodes(node.children)}
    </li>)}</ul>;
  }
  return <main className="flow-page">
    <header className="flow-header"><div><Link href="/">← Knowledge Studio</Link><p className="flow-eyebrow">ENGINE EXPLORER</p><h1>See what happens to your content.</h1><p>Choose sources and options. Follow the branches from ingestion to approval, and inspect the prompts behind each AI step.</p></div>
      <div className="flow-header-actions">{!executionMode && <button onClick={() => { const blob = new Blob([diagram], { type: "text/plain" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "knowledge-studio-flow.mmd"; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }}>Download Mermaid tree</button>}
      <button onClick={() => window.print()}>Print / save PDF</button><SignOutButton /></div>
    </header>
    <ExecutionHistory initialRunId={executed ? runId : undefined} onModeChange={setExecutionMode} />
    {!executionMode && <div className="flow-layout">
      <aside className="flow-controls">
        <h2>Build a scenario</h2><p>This explorer makes no AI calls or KB writes. Outcome controls let you inspect possible branches; they do not predict results.</p>
        <label className="flow-toggle"><input type="checkbox" checked={!!settings.autonomous} onChange={e => update("autonomous", e.target.checked)} />Autonomous mode</label>
        <fieldset><legend>1. Sources</legend>{([["text", "Typed / pasted content"], ["file", "Uploaded document"], ["url", "Fetched URL"], ["existing", "Existing KB article"]] as const).map(([key, label]) => <label className="flow-toggle" key={key}><input type="checkbox" checked={settings[key]} onChange={(e) => update(key, e.target.checked)} />{label}</label>)}</fieldset>
        <fieldset><legend>2. Selected operations</legend>{options.map(([key, label]) => <label className="flow-toggle" key={key}><input type="checkbox" checked={settings[key]} onChange={(e) => update(key, e.target.checked)} />{label}</label>)}</fieldset>
        {!settings.autonomous && <fieldset><legend>3. Explore possible outcomes</legend>
          <label>Topics after analysis<select value={settings.topics} onChange={(e) => update("topics", Number(e.target.value))}><option value={1}>One topic</option><option value={2}>Two or more topics</option></select></label>
          <label className="flow-toggle"><input type="checkbox" checked={settings.existingSplits} disabled={!settings.existing || !settings.split} onChange={(e) => update("existingSplits", e.target.checked)} />An existing source splits into several topics</label>
          <label className="flow-toggle"><input type="checkbox" checked={settings.fixedTemplate} onChange={(e) => update("fixedTemplate", e.target.checked)} />Template fixed in analysis request</label>
          <label>Duplicate evidence<select value={settings.matches} onChange={(e) => update("matches", e.target.value as FlowOptions["matches"])} disabled={!settings.dedupe}><option value="none">No KB neighbours</option><option value="low">Possible matches below 80</option><option value="high">Group with overlap score ≥80</option></select></label>
          <label className="flow-toggle"><input type="checkbox" checked={settings.batchOverlap} disabled={!settings.dedupe || settings.topics < 2} onChange={(e) => update("batchOverlap", e.target.checked)} />Drafts in this batch overlap at 80 or above</label>
          <label>Author’s duplicate decision<select value={settings.decision} onChange={(e) => update("decision", e.target.value as FlowOptions["decision"])} disabled={!settings.dedupe || (settings.matches !== "high" && !settings.batchOverlap)}><option value="pending">Waiting for a decision</option><option value="separate">Keep separate</option><option value="merge">Merge and choose a survivor</option></select></label>
          <label>Chosen survivor<select value={settings.survivor} onChange={(e) => update("survivor", e.target.value as FlowOptions["survivor"])}><option value="existing">Existing article, if one is in the group</option><option value="new">New draft</option></select></label>
          <label className="flow-toggle"><input type="checkbox" checked={settings.conflict} onChange={(e) => update("conflict", e.target.checked)} />Sources contain a factual conflict</label>
          <label className="flow-toggle"><input type="checkbox" checked={settings.resolved} onChange={(e) => update("resolved", e.target.checked)} />Author resolved the conflict</label>
          <label>Write outcome<select value={settings.failure} onChange={(e) => update("failure", e.target.value as FlowOptions["failure"])}><option value="none">Success</option><option value="rejected">Definite rejection</option><option value="uncertain">Lost / uncertain response</option></select></label>
        </fieldset>}
        {settings.autonomous && <p>The autonomous tree shows each possible agent decision and its recovery path. Outcomes are determined by evidence during the real run.</p>}
        <button onClick={() => { setSettings(DEFAULT_FLOW); setSelected(null); }}>Reset scenario</button>
      </aside>
      <section className="flow-diagram" aria-label="Knowledge Studio decision tree">
        <div className="flow-diagram-toolbar"><div><h2>The complete decision tree</h2><p>{activePrompts.length} active prompt types · click a node for details</p></div><label className="flow-toggle"><input type="checkbox" checked={onlyActive} onChange={(e) => setOnlyActive(e.target.checked)} />Show selected path only</label></div>
        <div className="flow-legend">{Object.entries(kinds).map(([key, label]) => <span className={`flow-kind-${key}`} key={key}>{label}</span>)}</div>
        {nodes(tree, true)}
      </section>
      <aside className="flow-inspector" aria-live="polite">
        {runId && <section><h2>Your recorded run</h2><p>Read the actual prompts and model responses recorded by this run. Refresh after analysis or submission to see new calls.</p><button onClick={async () => {
          try { const response = await fetch(`/api/runs/trace?runId=${encodeURIComponent(runId)}`); const value = await response.json(); if (!response.ok) throw new Error(value.error); setTrace(value); } catch (e) { setNotice((e as Error).message); }
        }}>Load / refresh recorded activity</button>
        {trace && <><p>{trace.status} · total recorded ${trace.costUsd.toFixed(4)}</p>{trace.calls.map((call) => <details key={call.id}><summary>{call.phase}: {call.operation} · {call.model}</summary><p>{call.inputTokens} input / {call.outputTokens} output tokens · ${call.costUsd.toFixed(4)}</p><strong>Actual request</strong><pre>{JSON.stringify(JSON.parse(call.request), null, 2)}</pre><strong>Actual response</strong><pre>{JSON.stringify(JSON.parse(call.response), null, 2)}</pre></details>)}</>}
        </section>}
        <h2>{current?.title ?? "Inspect a stage"}</h2><p>{current?.detail ?? "Select any node. AI nodes show the system prompt, operator task, example data and output schema used by the actual implementation."}</p>
        {current && <p className="flow-status">{current.active ? "Active in your scenario" : "Inactive in your scenario — shown as an alternative"}</p>}
        {prompt && <div id={`prompt-${prompt.id}`}>
          <p><strong>{prompt.model}</strong><br />Prompt version {prompt.version}</p>
          <p>Built by the same functions as the engine. Template fields, rules and retrieved evidence below are illustrative substitutions, not live tenant data.</p>
          <label>Example source content<textarea value={sample} onChange={(e) => setSample(e.target.value)} rows={5} /></label>
          <details open><summary>System prompt</summary><pre>{prompt.system}</pre></details>
          <details open><summary>User message: source data + operator task</summary><pre>{prompt.user.replaceAll("{{content}}", sample)}</pre></details>
          <details><summary>Required output schema</summary><pre>{prompt.schema}</pre></details>
          <button onClick={async () => { try { await navigator.clipboard.writeText(`${prompt.system}\n\n${prompt.user.replaceAll("{{content}}", sample)}`); setNotice("Prompt copied"); } catch { setNotice("Select the prompt text to copy it manually"); } }}>Copy example prompt</button>
        </div>}
        {!prompt && current && <p>No model call happens in this node. {current.kind === "human" ? "The engine waits for an explicit user choice here." : "This stage is handled by application code or RightAnswers."}</p>}
        {notice && <p role="status">{notice}</p>}
        <details><summary>Mermaid source for this scenario</summary><pre>{diagram}</pre></details>
      </aside>
    </div>}
  </main>;
}
