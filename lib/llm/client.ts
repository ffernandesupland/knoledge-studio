import { AsyncLocalStorage } from "node:async_hooks";
import { auditAi } from "./audit";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import type { ZodType } from "zod";
import { config } from "../config";
import { estimateCostUsd, modelFor } from "./models";
import { buildUserPrompt, systemPrompt, type UntrustedBlock } from "./prompt";

let client: OpenAI | null = null;

function openai(): OpenAI {
  if (!config.openai.apiKey) {
    throw new Error("OPENAI_API_KEY is not set. Add it to .env to run pipeline operations.");
  }
  client ??= new OpenAI({ apiKey: config.openai.apiKey, timeout: 120_000, maxRetries: 1 });
  return client;
}

export interface RunResult<T> {
  data: T;
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface RunArgs<T> {
  /** Key from OPERATION_TIER; selects the model. */
  operation: string;
  /** Trusted role description for the system prompt. */
  role: string;
  /** Trusted instruction, placed after the untrusted data. */
  task: string;
  /** Ingested material, wrapped as inert data. */
  blocks?: UntrustedBlock[];
  schema: ZodType<T>;
  schemaName: string;
}

/**
 * Single entry point for every pipeline operation: structured output only, never free prose,
 * with untrusted content isolated by lib/llm/prompt.ts.
 */
export async function runOperation<T>(args: RunArgs<T>): Promise<RunResult<T>> {
  if (inspection.getStore()) throw new PromptCapture(args as RunArgs<unknown>);
  if ((args.blocks ?? []).reduce((n, b) => n + b.content.length, 0) > 500_000) throw new Error("Model input exceeds 500,000 characters; use a smaller batch.");
  const model = modelFor(args.operation);
  const input = [
    { role: "system" as const, content: systemPrompt(args.role) },
    { role: "user" as const, content: buildUserPrompt(args.task, args.blocks ?? []) },
  ];

  const response = await openai().responses.parse({
    model,
    input,
    text: { format: zodTextFormat(args.schema, args.schemaName) },
  });

  const parsed = response.output_parsed;
  const inputTokens = response.usage?.input_tokens ?? 0;
  const outputTokens = response.usage?.output_tokens ?? 0;
  const usage = { model, inputTokens, outputTokens, costUsd: estimateCostUsd(model, inputTokens, outputTokens) };
  // Record charged responses even if refusal/schema validation prevents authoring.
  (await auditAi(args as RunArgs<unknown>, { ...usage, data: parsed ?? { error: "No parseable output", output: response.output } }, input));
  if (!parsed) throw new Error(`${args.operation}: model returned no parseable output`);
  const result: RunResult<T> = { ...usage, data: args.schema.parse(parsed) };
  return result;
}

const inspection = new AsyncLocalStorage<boolean>();
class PromptCapture extends Error {
  constructor(readonly args: RunArgs<unknown>) { super("Prompt inspection"); }
}
/** Runs only the prompt builder, stopping before any SDK call, with per-request isolation. */
export async function inspectPrompt(fn: () => unknown): Promise<RunArgs<unknown>> {
  return inspection.run(true, async () => {
    try { await fn(); } catch (e) { if (e instanceof PromptCapture) return e.args; throw e; }
    throw new Error("No AI prompt reached");
  });
}
