import { z } from "zod";
import { groundContextSchema, groundIdentity } from "../ground-context/types";
import { ApiError } from "./auth";
import type { StoredRun, DecisionSnapshot } from "../db/runs";
import { KS_OPS_DEFAULT } from "../ks/data";

export const fieldSchema = z.object({ fieldName: z.string().min(1).max(200), fieldValue: z.string().max(500_000) });
const fields = z.array(fieldSchema).max(100);
const operationName = z.enum(["Discover and suggest metadata", "Split topics", "Restructure content", "Apply content standards", "Find duplicates", "Optimize for search", "Find gaps"]);
export const runSchema = z.object({
  connectionId: z.string().max(100).optional(),
  reviewHandoffId: z.string().uuid().optional(),
  groundContext: groundContextSchema.optional(),
  text: z.string().max(500_000), attachments: z.array(z.object({ label: z.string().max(500), text: z.string().max(500_000), kind: z.enum(["file", "url"]).optional(), id: z.string().max(100).optional(), imageId: z.string().uuid().optional(), fileId: z.string().uuid().optional(), meta: z.string().max(500).optional() })).max(20).optional(),
  content: z.array(z.discriminatedUnion("type", [
    z.object({ id: z.string().max(100), type: z.literal("text"), text: z.string().max(500_000) }),
    z.object({ id: z.string().max(100), type: z.literal("attachment"), attachmentId: z.string().max(100) }),
  ])).max(200).optional(),
  sourceSolutionIds: z.array(z.string().regex(/^\d{15}$/)).max(20).refine((v) => new Set(v).size === v.length, "Source IDs must be unique").optional(),
  operations: z.array(operationName).max(7), templateName: z.string().max(200).optional(),
  path: z.enum(["create", "improve", "gap"]).optional(), collection: z.string().max(200).optional(), language: z.string().max(100).optional(),
}).superRefine((v, ctx) => {
  if (v.groundContext?.enabled) {
    if (v.groundContext.referenceSolutionIds.some(id => v.sourceSolutionIds?.includes(id))) ctx.addIssue({ code: "custom", message: "Processing targets and Ground Context references must be different solutions" });
    if (!v.text.trim() && !v.sourceSolutionIds?.length && !v.attachments?.length && !v.content?.some(block => block.type === "text" && block.text.trim())) ctx.addIssue({ code: "custom", message: "Add a task or source content alongside Ground Context references" });
  }
  if (!v.content) return;
  const ids = (v.attachments ?? []).map(a => a.id);
  const refs = v.content.flatMap(b => b.type === "attachment" ? [b.attachmentId] : []);
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || new Set(refs).size !== refs.length || refs.length !== ids.length || refs.some(id => !ids.includes(id))) ctx.addIssue({ code: "custom", message: "Editor sources must match attachments exactly" });
  if (new Set(v.content.map(b => b.id)).size !== v.content.length) ctx.addIssue({ code: "custom", message: "Editor block IDs must be unique" });
  if (v.content.reduce((n,b) => n + (b.type === "text" ? b.text.length : 0),0) + (v.attachments ?? []).reduce((n,a)=>n+a.text.length,0) > 500_000) ctx.addIssue({ code: "custom", message: "Use a smaller source batch (500,000 characters maximum)" });
}).refine((v) => v.text.length + (v.attachments ?? []).reduce((n, a) => n + a.text.length, 0) <= 500_000, "Use a smaller source batch (500,000 characters maximum)");
const candidatePatch = z.object({
  key: z.string().max(100), title: z.string().min(1).max(500), summary: z.string().max(4000).optional(), keywords: z.array(z.string().max(100)).max(30).optional(),
  templateName: z.string().max(200), fields, rawContent: z.string().max(500_000), titleLocked: z.boolean().optional(),
});
const metadataValues = z.object({ collections: z.array(z.string().min(1).max(200)).min(1).max(20).optional(), taxonomies: z.array(z.string().min(1).max(1000)).max(20).optional(), language: z.string().min(1).max(100).optional() });
export const snapshotSchema = z.object({
  groundContextIdentity: z.string().max(10000).optional(),
  metadata: z.object({ global: metadataValues.optional(), solutions: z.record(z.string().max(100), metadataValues).optional(),
    decisions: z.record(z.string().max(100), z.record(z.string().max(3000), z.object({ status: z.enum(["accepted", "rejected", "deferred"]), kind: z.enum(["collection", "taxonomy", "attribute"]), value: z.string().max(1000), label: z.string().max(1200), attributeName: z.string().max(200).optional(), attributeSet: z.string().max(200).optional(), sourceEvidence: z.string().max(500), researchIdentity: z.string().max(100) }))).optional(),
  }).optional(),
  candidates: z.array(candidatePatch).max(60), groups: z.array(z.object({ survivorId: z.string().max(100) }).passthrough()).max(60),
  selectedKeys: z.array(z.string().max(100)).max(60), resolutions: z.array(z.enum(["separate", "merged"]).nullable()).max(60),
  operations: z.array(z.object({ name: operationName, on: z.boolean() }).passthrough()).min(6).max(7),
  collection: z.string().max(200), language: z.string().max(100), standard: z.string().max(100),
  standardsRules: z.array(z.string().min(1).max(500)).max(20), newSolutionTemplate: z.string().max(200).nullable(), templateOverrides: z.array(z.string().max(100)).max(60),
});
export const reviewSchema = z.record(z.string().max(200), z.object({ version: z.string().uuid(), fields, title: z.string().min(1).max(500).optional(), summary: z.string().max(4000).optional(), keywords: z.array(z.string().max(100)).max(30).optional(), regenerate: z.boolean().optional(), templateName: z.string().max(200).optional() }));

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
  if (input.groundContextIdentity !== groundIdentity(run.groundContext)) throw new ApiError("Ground Context changed. Analyze and prepare the current references again.", 409);
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
  if (new Set(input.operations.map((o) => o.name)).size !== input.operations.length || KS_OPS_DEFAULT.filter(o => o.name !== "Discover and suggest metadata").some(o => !input.operations.some(v => v.name === o.name))) throw new ApiError("Invalid operation choices");
  return { ...input, candidates, groups, operations: KS_OPS_DEFAULT.map((o) => ({ ...o, on: input.operations.find((v) => v.name === o.name)?.on ?? false })) };
}

export function assertOwner(run: StoredRun | null, author: string): asserts run is StoredRun {
  if (!run || run.author !== author) throw new ApiError("Run not found", 404);
  if (run.status === "discarded") throw new ApiError("Run was discarded. Start a new analysis.", 409);
}
