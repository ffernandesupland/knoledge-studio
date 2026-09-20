/**
 * Model routing. Reasoning-grade work (restructuring, merging, duplicate adjudication) goes
 * to terra; mechanical work (query generation, standards, keywords) goes to luna.
 *
 * Standard pricing per 1M tokens, 2026-09-03:
 *   gpt-5.6-terra  $2.00 in / $12.00 out
 *   gpt-5.6-luna   $0.20 in /  $1.20 out
 */
export const MODELS = {
  reasoning: "gpt-5.6-terra",
  cheap: "gpt-5.6-luna",
} as const;

export type ModelTier = keyof typeof MODELS;

/** USD per 1M tokens, used for per-run cost accounting. */
export const PRICING: Record<string, { input: number; output: number }> = {
  "gpt-5.6-terra": { input: 2.0, output: 12.0 },
  "gpt-5.6-luna": { input: 0.2, output: 1.2 },
};

export const OPERATION_TIER: Record<string, ModelTier> = {
  groundEnrich: "reasoning",
  groundReview: "reasoning",
  metadataRecommend: "reasoning",
  metadataExplore: "cheap",
  autonomousDecide: "reasoning",
  autonomousReview: "reasoning",
  readImage: "reasoning",
  split: "reasoning",
  plan: "reasoning",
  restructure: "reasoning",
  compose: "reasoning",
  mergeSections: "reasoning",
  // Adjudication reads long context but makes a narrow judgement; luna handles it at ~1/10 cost.
  dedupeAdjudicate: "cheap",
  chooseTemplate: "cheap",
  dedupeQuery: "cheap",
  standards: "cheap",
  optimizeSearch: "cheap",
  findGaps: "cheap",
  solutionReview: "reasoning",
};

export function modelFor(operation: string): string {
  return MODELS[OPERATION_TIER[operation] ?? "cheap"];
}

export function estimateCostUsd(model: string, inputTokens: number, outputTokens: number): number {
  const p = PRICING[model];
  if (!p) return 0;
  return (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
}
