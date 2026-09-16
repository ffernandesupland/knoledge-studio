import { sourceContext } from "./source-context";
import { orderedModelContent } from "./model-content";
import { tracked } from "../autonomous/telemetry";
import { AsyncLocalStorage } from "node:async_hooks";
import { auditAi, PROMPT_VERSION } from "./audit";
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
  images?: string[];
  contextBlocks?: UntrustedBlock[];
  schema: ZodType<T>;
  schemaName: string;
}

/**
 * Single entry point for every pipeline operation: structured output only, never free prose,
 * with untrusted content isolated by lib/llm/prompt.ts.
 */
export async function runOperation<T>(args: RunArgs<T>): Promise<RunResult<T>> {
  const usesOriginals = ["split", "plan", "chooseTemplate", "restructure", "compose", "mergeSections", "autonomousReview", "metadataExplore", "metadataRecommend"].includes(args.operation);
  args = { ...args, contextBlocks: args.contextBlocks ?? (usesOriginals ? sourceContext() : []) };
  if (inspection.getStore()) throw new PromptCapture(args as RunArgs<unknown>);
  if ([...(args.blocks ?? []), ...(args.contextBlocks ?? [])].reduce((n, b) => n + b.content.length, 0) > 500_000) throw new Error("Model input exceeds 500,000 characters; use a smaller batch.");
  const model = modelFor(args.operation);
  const input = [
    { role: "system" as const, content: systemPrompt(args.role) },
    { role: "user" as const, content: args.contextBlocks?.length ? await orderedModelContent(args.contextBlocks, args.blocks ?? [], args.task) : args.images?.length ? [
      { type: "input_text" as const, text: buildUserPrompt(args.task, args.blocks ?? []) },
      ...args.images.map(image_url => ({ type: "input_image" as const, image_url, detail: "high" as const })),
    ] : buildUserPrompt(args.task, args.blocks ?? []) },
  ];

  // Keep durable original-image references in logs; do not copy base64 images into every trace.
  let imageIndex = 0;
  const auditInput = input.map(message => ({ ...message, content: Array.isArray(message.content) ? message.content.map(part => part.type === "input_image" ? { ...part, image_url: `source-image:${args.contextBlocks?.filter(b => b.imageId)[imageIndex++]?.imageId ?? "direct"}` } : part) : message.content }));
  return tracked("model", args.operation, { model, input: auditInput, schemaName: args.schemaName }, async () => {
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
    (await auditAi(args as RunArgs<unknown>, { ...usage, data: parsed ?? { error: "No parseable output", output: response.output } }, auditInput));
    try {
      if (!parsed) throw new Error(`${args.operation}: model returned no parseable output`);
      return { ...usage, data: args.schema.parse(parsed) };
    } catch (error) {
      // A local structured-output retry must retain the cost of the charged response.
      if (error instanceof Error) Object.assign(error, { costUsd: usage.costUsd });
      throw error;
    }
  }, true, undefined, { model, role: args.role, task: args.task, blocks: args.blocks, contextBlocks: args.contextBlocks, schemaName: args.schemaName, promptVersion: PROMPT_VERSION });
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
