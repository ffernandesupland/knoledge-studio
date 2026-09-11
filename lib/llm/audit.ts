import { AsyncLocalStorage } from "node:async_hooks";
import { db } from "../db";
import type { RunArgs, RunResult } from "./client";

export const PROMPT_VERSION = "2026-09-10.1";
const context = new AsyncLocalStorage<{ runId: string; phase: string }>();
export function withAiAudit<T>(runId: string, phase: string, fn: () => Promise<T>) {
  return context.run({ runId, phase }, fn);
}
export async function auditAi<T>(args: RunArgs<T>, result: RunResult<T>, input: unknown) {
  const ctx = context.getStore();
  if (!ctx) return;
  (await db().transaction(async () => {
    (await db().prepare(`INSERT INTO ai_calls(run_id,phase,ts,operation,model,input_tokens,output_tokens,cost_usd,prompt_version,request,response)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(ctx.runId, ctx.phase, new Date().toISOString(), args.operation, result.model, result.inputTokens, result.outputTokens, result.costUsd, PROMPT_VERSION, JSON.stringify(input), JSON.stringify(result.data)));
    (await db().prepare("UPDATE runs SET cost_usd=cost_usd+? WHERE id=?").run(result.costUsd, ctx.runId));
  })());
}
