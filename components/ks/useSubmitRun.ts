"use client";
import { useState } from "react";
import type { OpResult, ContentReview } from "@/lib/pipeline/execute";
import type { WriteOp } from "@/lib/pipeline/submit";
import type { DecisionSnapshot } from "@/lib/db/runs";
import { readNdjson } from "@/lib/ks/stream";
import type { ReferenceChange } from "@/lib/ground-context/server";
export interface SubmitRequest { runId: string; snapshot: DecisionSnapshot; reviews?: Record<string, ContentReview>; approvals?: Record<string, string> }
export type SubmitPhase = "idle" | "preparing" | "prepared" | "submitting" | "done" | "error";
export function useSubmitRun() {
  const [phase, setPhase] = useState<SubmitPhase>("idle");
  const [plan, setPlan] = useState<WriteOp[]>([]);
  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const [results, setResults] = useState<OpResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [costUsd, setCostUsd] = useState<number | null>(null);
  const [identity, setIdentity] = useState<string | undefined>();
  const [locked, setLocked] = useState(false);
  const [referenceChanges, setReferenceChanges] = useState<ReferenceChange[]>([]);
  const [progress, setProgress] = useState("");
  function restore(savedPlan: WriteOp[], savedResults: OpResult[], stage?: string, reviewIdentity?: string, changes: ReferenceChange[] = []) {
    setReferenceChanges(changes);
    if (changes.length) setError("Reference knowledge needs attention. Your saved drafts are retained below.");
    setPlan(savedPlan); setResults(savedResults); setIdentity(reviewIdentity); setLocked(stage !== "preparation"); setPhase(stage === "preparation" ? "prepared" : "done");
  }
  async function run(action: "prepare" | "submit", request: SubmitRequest) {
    setPhase(action === "prepare" ? "preparing" : "submitting"); setError(null); setReferenceChanges([]); setProgress("Checking selected references and article settings…");
    let activePlan = plan;
    try {
      const response = await fetch("/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...request, action }) });
      await readNdjson(response, (msg) => {
        if (msg.type === "plan") {
          activePlan = msg.plan as WriteOp[]; setPlan(activePlan); setIdentity(msg.reviewIdentity as string | undefined); setLocked(msg.stage !== "preparation");
          setResults(old => old.filter(r => activePlan.some(op => op.idempotencyKey === r.idempotencyKey)));
        } else if (msg.type === "progress") {
          setProgress(String(msg.description ?? "Preparing draft…"));
          setCurrentKey(activePlan[Number(msg.index)]?.idempotencyKey ?? null);
          if (msg.result) setResults((old) => [...old.filter((r) => r.idempotencyKey !== (msg.result as OpResult).idempotencyKey), msg.result as OpResult]);
        } else if (msg.type === "error") { setReferenceChanges((msg.referenceChanges as ReferenceChange[] | undefined) ?? []); }
        else if (msg.type === "result") { setResults(msg.results as OpResult[]); setCostUsd(Number(msg.costUsd ?? 0)); }
      });
      setCurrentKey(null); setPhase(action === "prepare" ? "prepared" : "done");
    } catch (e) { setCurrentKey(null); setError((e as Error).message); setPhase("error"); }
  }
  function reset() { setPhase("idle"); setPlan([]); setCurrentKey(null); setResults([]); setError(null); setCostUsd(null); setIdentity(undefined); setLocked(false); setReferenceChanges([]); }
  return { phase, plan, currentKey, results, error, referenceChanges, progress, costUsd, identity, locked, prepare: (r: SubmitRequest) => run("prepare", r), submit: (r: SubmitRequest) => run("submit", r), reset, restore };
}
