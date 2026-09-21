"use client";
import type { SourceAttachment, SourceBlock } from "@/lib/ks/source-document";
import { useRef, useState } from "react";
import type { ProgressEvent, RunOutput } from "@/lib/pipeline/run";
import { mapRunToView, type ViewCandidate, type ViewRun } from "@/lib/ks/model";
import { readNdjson } from "@/lib/ks/stream";
export interface RunRequest {
  connectionId?: string;
  reviewHandoffId?: string;
  groundContext?: import("@/lib/ground-context/types").GroundContextInput;
  text: string;
  attachments?: SourceAttachment[];
  content?: SourceBlock[];
  sourceSolutionIds?: string[];
  duplicateScopeIds?: string[];
  operations: string[];
  path?: string;
}
export type RunPhase = "idle" | "running" | "done" | "error";
export interface StepState { name: string; status: "running" | "done" }
export function usePipelineRun() {
  const [phase, setPhase] = useState<RunPhase>("idle");
  const [steps, setSteps] = useState<StepState[]>([]);
  const [run, setRun] = useState<ViewRun | null>(null);
  const [runId, setRunId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  function restore(id: string, view: ViewRun) { setRunId(id); setRun(view); setPhase("done"); setSteps([]); setError(null); }
  async function start(request: RunRequest): Promise<ViewRun | null> {
    const current = ++generation.current;
    setPhase("running"); setSteps([]); setRun(null); setRunId(null); setError(null);
    let completed: ViewRun | null = null;
    try {
      const response = await fetch("/api/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      await readNdjson(response, (msg) => {
        if (current !== generation.current) return;
        if (msg.type === "runId") setRunId(String(msg.runId));
        else if (msg.type === "progress") {
          const e = msg as unknown as ProgressEvent;
          setSteps((prev) => e.status === "start" ? [...prev, { name: e.step, status: "running" }] : prev.map((s) => s.name === e.step ? { ...s, status: "done" } : s));
        } else if (msg.type === "result") completed = mapRunToView(msg as unknown as RunOutput);
      });
      if (current !== generation.current) return null;
      setRun(completed); setPhase("done"); return completed;
    } catch (e) { if (current === generation.current) { setError((e as Error).message); setPhase("error"); } return null; }
  }
  function reset() { generation.current++; setPhase("idle"); setSteps([]); setRun(null); setRunId(null); setError(null); }
  function updateCandidate(key: string, patch: Partial<Pick<ViewCandidate, "templateName" | "fields" | "rawContent" | "title" | "titleLocked" | "summary" | "keywords" | "edited">>) {
    setRun((prev) => prev ? { ...prev, candidates: prev.candidates.map((c) => c.key === key ? { ...c, ...patch } : c) } : prev);
  }
  return { phase, steps, run, runId, error, start, restore, reset, updateCandidate };
}
