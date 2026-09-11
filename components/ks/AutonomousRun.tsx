"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { SignOutButton } from "../auth/SignOutButton";
import { LoadingProgress } from "./LoadingProgress";
import { SubmissionGraph } from "./SubmissionGraph";
import { AutonomousLog } from "../flow/AutonomousLog";
import type { SubmissionGraphModel } from "@/lib/ks/submission-graph";
import type { AutonomousStage, AutonomousStatus } from "@/lib/autonomous/types";

type RunStatus = { status: AutonomousStatus; stage: AutonomousStage; error?: string; graph?: SubmissionGraphModel; costUsd: number; workerOnline: boolean };
const stages: Record<AutonomousStage, string> = { queued: "Waiting for the worker", analysis: "Gathering evidence and planning", decisions: "Choosing articles, merges and metadata", preparation: "Preparing articles in their templates", review: "Checking articles against the sources", submission: "Creating review drafts and revisions", finished: "Execution finished" };
export function AutonomousRun({ runId, onClose }: { runId: string; onClose: () => void }) {
  const [run, setRun] = useState<RunStatus | null>(null);
  const [error, setError] = useState("");
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
  }, [runId]);
  const active = !run || ["queued", "running"].includes(run.status);
  const flowHref = `/flow?view=executed&runId=${encodeURIComponent(runId)}`;
  return <div className="ks-wizard">
    <div id="page-hdr"><div className="page-title">Knowledge Studio</div><Link className="ds-btn ds-btn-secondary" href={flowHref} target="_blank">Open executed engine flow</Link><SignOutButton /></div>
    <main className="ks-scroll auto-run">
      <h1>{active ? "Running autonomously" : run?.status === "completed" ? "Your articles have been submitted for review" : "Execution finished with unresolved items"}</h1>
      <p>The agent plans, chooses merges and metadata, prepares articles, checks the evidence, and submits approved drafts. Publication still follows your approval workflow.</p>
      {error && <p role="alert">{error} — reconnecting to the saved run.</p>}
      {active && <div className="ks-card"><LoadingProgress label={stages[run?.stage ?? "queued"]} /><p>You can close this page and return using the saved link or Past executions. The Node worker continues independently.</p>{run && !run.workerOnline && <p role="status">The worker is offline. Saved progress will resume when it reconnects.</p>}</div>}
      {run?.error && <div className="ks-card" role="alert">{run.error}</div>}
      {run?.graph && <SubmissionGraph model={run.graph} mode="history" flowHref={flowHref} decisionActor="agent" />}
      <p>Recorded AI cost: ${(run?.costUsd ?? 0).toFixed(4)} · <Link href={`/?autonomousRun=${encodeURIComponent(runId)}`}>Saved run link</Link></p>
      <AutonomousLog key={runId} runId={runId} live={active} />
    </main>
    <div className="ks-sticky-footer"><span className="ks-foot-status">{active ? stages[run?.stage ?? "queued"] : run?.status === "completed" ? "All planned writes completed — nothing published" : "Completed writes are saved. Inspect the diagram and activity for pending items."}</span><button type="button" className="ds-btn ds-btn-primary" onClick={onClose}>{active ? "Return to content" : "Finish"}</button></div>
  </div>;
}
