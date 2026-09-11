import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { assertLease, checkpoint, event, saveCheckpoint } from "./store";
import type { AutonomousStage } from "./types";

const context = new AsyncLocalStorage<{ runId: string; token: string; stage: AutonomousStage }>();
export function withAutonomousContext<T>(runId: string, token: string, stage: AutonomousStage, fn: () => Promise<T>) {
  return context.run({ runId, token, stage }, fn);
}
/** No context means the existing guided flow executes without new logging or caching. */
export async function tracked<T>(kind: "model" | "tool", name: string, input: unknown, fn: () => Promise<T>, readOnly = false, loggedOutput: (value: T) => unknown = value => value, cacheIdentity: unknown = input): Promise<T> {
  const ctx = context.getStore();
  if (!ctx) return fn();
  await assertLease(ctx.runId, ctx.token);
  const correlationId = randomUUID();
  const key = `read:${ctx.stage}:${createHash("sha256").update(JSON.stringify({ kind, name, input: cacheIdentity })).digest("hex")}`;
  // Analysis may be replayed after a request interruption. Submission always re-reads live sources.
  const cache = readOnly && ["analysis", "decisions"].includes(ctx.stage);
  const cached = cache ? await checkpoint<{ value: T }>(ctx.runId, key) : undefined;
  if (cached) {
    await event(ctx.runId, ctx.stage, kind, name, "skipped", { input, correlationId, explanation: "Reused a saved read from this stage after resumption; no new call made." });
    return cached.value;
  }
  await event(ctx.runId, ctx.stage, kind, name, "started", { input, correlationId });
  try {
    const value = await fn();
    await event(ctx.runId, ctx.stage, kind, name, "succeeded", { output: loggedOutput(value), correlationId });
    await assertLease(ctx.runId, ctx.token);
    if (cache) await saveCheckpoint(ctx.runId, key, { value });
    return value;
  } catch (e) {
    await event(ctx.runId, ctx.stage, kind, name, "failed", { correlationId, explanation: e instanceof Error ? e.message : String(e) });
    throw e;
  }
}
