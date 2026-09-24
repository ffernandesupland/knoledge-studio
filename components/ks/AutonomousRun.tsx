"use client";
import { useEffect, useState } from "react";
import { readNdjson } from "@/lib/ks/stream";
import Link from "next/link";
import { SignOutButton } from "../auth/SignOutButton";
import { LoadingProgress } from "./LoadingProgress";
import { SubmissionGraph } from "./SubmissionGraph";
import { AutonomousLog } from "../flow/AutonomousLog";
import { AutonomousOutcome } from "./AutonomousOutcome";
import type { AutonomousOutcome as Outcome } from "@/lib/autonomous/outcome";
import type { SubmissionGraphModel } from "@/lib/ks/submission-graph";
import type { AutonomousStage, AutonomousStatus } from "@/lib/autonomous/types";

type RunStatus = { status: AutonomousStatus; stage: AutonomousStage; error?: string; graph?: SubmissionGraphModel; costUsd: number; outcome: Outcome };
const stages: Record<AutonomousStage, string> = { queued: "Starting your run", analysis: "Gathering evidence and planning", decisions: "Choosing articles, merges and metadata", preparation: "Preparing articles in their templates", review: "Checking articles against the sources", submission: "Creating review drafts and revisions", finished: "Execution finished" };
export function AutonomousRun({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState("");
  const [advanceError, setAdvanceError] = useState("");
  const [revision, setRevision] = useState(0);
  const [resuming, setResuming] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function advance() {
      try {
        const response = await fetch("/api/autonomous/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }), signal: controller.signal });
        let status = "running", busy = false;
        await readNdjson(response, message => { if (message.type === "result") { status = String(message.status); busy = !!message.busy; } });
        if (controller.signal.aborted) return;
        setAdvanceError("");
        if (["queued", "running"].includes(status)) timer = setTimeout(advance, busy ? 4000 : 250);
      } catch (e) {
        if (!controller.signal.aborted) { setAdvanceError(e instanceof Error ? e.message : "Connection interrupted"); timer = setTimeout(advance, 5000); }
      }
    }
    void advance();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, revision]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const response = await fetch(`/api/autonomous?runId=${encodeURIComponent(runId)}`, { signal: controller.signal });
        const data = await response.json(); if (!response.ok) throw new Error(data.error);
        if (controller.signal.aborted) return;
        setRun(data); setError("");
        if (["queued", "running"].includes(data.status)) timer = setTimeout(poll, 4000);
      } catch (e) { if (!controller.signal.aborted) { setError(e instanceof Error ? e.message : "Could not load this run"); timer = setTimeout(poll, 5000); } }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [runId, revision]);
  async function resume() {
    setResuming(true);
    try {
      const response = await fetch("/api/autonomous/resume", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error);
      setRun(null); setError(""); setAdvanceError(""); setRevision(value => value + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not resume this run"); }
    finally { setResuming(false); }
  }
  const active = !run || ["queued", "running"].includes(run.status);
  const flowHref = `/flow?view=executed&runId=${encodeURIComponent(runId)}`;
  return <div className="ks-wizard">
    <div id="page-hdr"><div className="page-title">Knowledge Studio</div><Link className="ds-btn ds-btn-secondary" href={flowHref} target="_blank">Open executed engine flow</Link><SignOutButton /></div>
    <main className="ks-scroll auto-run">
      <h1>{active ? "Running autonomously" : run?.status === "completed" ? "Your articles have been submitted for review" : run?.outcome.submitted === 0 ? "Execution stopped before submission" : "Execution finished with unresolved items"}</h1>
      <p>The agent plans, chooses merges and metadata, prepares articles, checks the evidence, and submits approved drafts. Publication still follows your approval workflow.</p>
      {(error || advanceError) && <p role="alert">{error || advanceError}{active ? " — reconnecting to the saved run." : ""}</p>}
      {active && <div className="ks-card"><LoadingProgress label={stages[run?.stage ?? "queued"]} /><p>This may take a few minutes. Keep this page open while the agent completes the run. If you leave, reopen this saved run to continue automatically.</p></div>}
      {run?.outcome && <AutonomousOutcome outcome={run.outcome} error={run.error} showProposals={!active && !run.graph?.rows.length} />}
      {run?.outcome.canResume && <div className="ks-card"><p>Your analysis is saved. Resume planning to choose actions and metadata, prepare articles, and submit them automatically.</p><button type="button" className="ds-btn ds-btn-primary" disabled={resuming} onClick={resume}>{resuming ? "Resuming…" : "Resume planning"}</button></div>}
      {!!run?.graph?.rows.length && <SubmissionGraph model={run.graph} runId={runId} mode="history" flowHref={flowHref} decisionActor="agent" />}
      <p>Recorded AI cost: ${(run?.costUsd ?? 0).toFixed(4)} · <Link href={`/?autonomousRun=${encodeURIComponent(runId)}`}>Saved run link</Link></p>
      <AutonomousLog key={runId} runId={runId} live={active} />
    </main>
    <div className="ks-sticky-footer"><span className="ks-foot-status">{active ? stages[run?.stage ?? "queued"] : run?.status === "completed" ? "All planned writes completed — nothing published" : run?.outcome.submitted === 0 ? "No articles submitted — saved progress and failure details are shown above." : "Completed writes are saved. Inspect the diagram and activity for pending items."}</span><button type="button" className="ds-btn ds-btn-primary" onClick={onClose}>{active ? "Return to content" : "Finish"}</button></div>
  </div>;
}
