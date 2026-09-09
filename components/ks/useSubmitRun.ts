"use client";
import { useState } from "react";
import type { OpResult, ContentReview } from "@/lib/pipeline/execute";
import type { WriteOp } from "@/lib/pipeline/submit";
import type { DecisionSnapshot } from "@/lib/db/runs";
import { readNdjson } from "@/lib/ks/stream";
export interface SubmitRequest { runId: string; snapshot: DecisionSnapshot; reviews?: Record<string, ContentReview> }
export type SubmitPhase = "idle" | "submitting" | "done" | "error";
export function useSubmitRun() {
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [plan, setPlan] = useState<WriteOp[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [results, setResults] = useState<OpResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  function restore(savedPlan: WriteOp[], savedResults: OpResult[]) { setPlan(savedPlan); setResults(savedResults); setPhase("done"); }
  async function submit(request: SubmitRequest) {
    setPhase("submitting"); setError(null);
    try {
      const response = await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(request) });
      await readNdjson(response, (msg) => {
        if (msg.type === "plan") setPlan(msg.plan as WriteOp[]);
        else if (msg.type === "progress") setCurrent(String(msg.description));
        else if (msg.type === "result") { setResults(msg.results as OpResult[]); setCostUsd(Number(msg.costUsd ?? 0)); }
      });
      setCurrent(null); setPhase("done");
    } catch (e) { setCurrent(null); setError((e as Error).message); setPhase("error"); }
  }
  function reset() { setPhase("idle"); setPlan([]); setCurrent(null); setResults([]); setError(null); setCostUsd(null); }
  return { phase, plan, current, results, error, costUsd, submit, reset, restore };
}
