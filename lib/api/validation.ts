import { z } from "zod";
import { ApiError } from "./auth";
import type { StoredRun, DecisionSnapshot } from "../db/runs";
import { KS_OPS_DEFAULT } from "../ks/data";

export const fieldSchema = z.object({ fieldName: z.string().min(1).max(200), fieldValue: z.string().max(500_000) });
const fields = z.array(fieldSchema).max(100);
const operationName = z.enum(["Split topics", "Restructure content", "Apply content standards", "Find duplicates", "Optimize for search", "Find gaps"]);
export const runSchema = z.object({
  text: z.string().max(500_000), attachments: z.array(z.object({ label: z.string().max(500), text: z.string().max(500_000), kind: z.enum(["file", "url"]).optional() })).max(20).optional(),
  sourceSolutionIds: z.array(z.string().regex(/^\d{15}$/)).max(20).refine((v) => new Set(v).size === v.length, "Source IDs must be unique").optional(),
  operations: z.array(operationName).max(6), templateName: z.string().max(200).optional(),
  path: z.enum(["create", "improve", "gap"]).optional(), collection: z.string().max(200).optional(), language: z.string().max(100).optional(),
}).refine((v) => v.text.length + (v.attachments ?? []).reduce((n, a) => n + a.text.length, 0) <= 500_000, "Use a smaller source batch (500,000 characters maximum)");
const candidatePatch = z.object({
  key: z.string().max(100), title: z.string().min(1).max(500), summary: z.string().max(4000).optional(), keywords: z.array(z.string().max(100)).max(30).optional(),
  templateName: z.string().max(200), fields, rawContent: z.string().max(500_000), titleLocked: z.boolean().optional(),
});
export const snapshotSchema = z.object({
  candidates: z.array(candidatePatch).max(60), groups: z.array(z.object({ survivorId: z.string().max(100) }).passthrough()).max(60),
  selectedKeys: z.array(z.string().max(100)).max(60), resolutions: z.array(z.enum(["separate", "merged"]).nullable()).max(60),
  operations: z.array(z.object({ name: operationName, on: z.boolean() }).passthrough()).length(6),
  collection: z.string().max(200), language: z.string().max(100), standard: z.string().max(100),
  standardsRules: z.array(z.string().min(1).max(500)).max(20), newSolutionTemplate: z.string().max(200).nullable(), templateOverrides: z.array(z.string().max(100)).max(60),
});
export const reviewSchema = z.record(z.string().max(200), z.object({ version: z.string().uuid(), fields, regenerate: z.boolean().optional(), templateName: z.string().max(200).optional() }));

export async function readJson<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("Missing request body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 4 * 1024 * 1024) { await reader.cancel(); throw new ApiError("Request exceeds 4 MB", 413); }
    chunks.push(value);
  }
  return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

/** The browser may edit content and choose survivors, never invent RA write targets. */
export function canonicalSnapshot(run: StoredRun, raw: unknown): DecisionSnapshot {
  if (run.formatVersion === 1) throw new ApiError("This run predates the source-identity fixes. Return to Content and analyze its restored sources again.", 409);
  const input = snapshotSchema.parse(raw);
  if (new Set(input.candidates.map((c) => c.key)).size !== run.candidates.length || input.candidates.length !== run.candidates.length) throw new ApiError("Candidate list does not match this run");
  for (const name of ["Split topics", "Find duplicates", "Optimize for search", "Find gaps"]) {
    if (input.operations.find((o) => o.name === name)?.on !== run.operations.includes(name)) throw new ApiError("Analysis options changed. Create a new plan before submitting.");
  }
  const candidates = run.candidates.map((original) => {
    const patch = input.candidates.find((c) => c.key === original.key);
    if (!patch) throw new ApiError("Unknown candidate");
    if (original.targetSolutionId && patch.templateName !== original.templateName) throw new ApiError("Existing articles retain their source template");
    const changed = patch.rawContent !== original.rawContent || JSON.stringify(patch.fields) !== JSON.stringify(original.fields);
    return { ...original, ...patch, edited: changed, titleLocked: patch.title !== original.title || original.titleLocked || patch.titleLocked };
  });
  if (input.groups.length !== run.groups.length || input.resolutions.length !== run.groups.length) throw new ApiError("Duplicate groups do not match this run");
  const groups = run.groups.map((g, i) => {
    const survivorId = input.groups[i].survivorId;
    if (!g.members.some((m) => m.id === survivorId)) throw new ApiError("Invalid survivor");
    return { ...g, survivorId, members: g.members.map((m) => ({ ...m, retained: m.id === survivorId })) };
  });
  if (input.selectedKeys.some((key) => !candidates.some((c) => c.key === key && !c.researchOnly))) throw new ApiError("Unknown or research-only candidate selected");
  if (new Set(input.operations.map((o) => o.name)).size !== 6) throw new ApiError("Invalid operation choices");
  return { ...input, candidates, groups, operations: KS_OPS_DEFAULT.map((o) => ({ ...o, on: input.operations.find((v) => v.name === o.name)!.on })) };
}

export function assertOwner(run: StoredRun | null, author: string): asserts run is StoredRun {
  if (!run || run.author !== author) throw new ApiError("Run not found", 404);
  if (run.status === "discarded") throw new ApiError("Run was discarded. Start a new analysis.", 409);
}
