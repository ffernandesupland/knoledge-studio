import { z } from "zod";

export const groundContextSchema = z.object({
  enabled: z.boolean(),
  referenceSolutionIds: z.array(z.string().regex(/^\d{15}$/)).max(8)
    .refine(ids => new Set(ids).size === ids.length, "Reference IDs must be unique"),
  referenceDocumentIds: z.array(z.string().uuid()).max(8).default([])
    .refine(ids => new Set(ids).size === ids.length, "Reference document IDs must be unique"),
  referenceTextIds: z.array(z.string().min(1).max(200)).max(8).default([])
    .refine(ids => new Set(ids).size === ids.length, "Reference text IDs must be unique"),
  guidance: z.string().max(1000).default(""),
  mode: z.enum(["manual", "bundle", "scope"]).default("manual"),
  bundleId: z.string().uuid().optional(),
  scope: z.object({ collection: z.string().trim().min(1).max(500).optional(), taxonomy: z.string().trim().min(1).max(500).optional() }).optional(),
}).refine(value => !value.enabled || value.referenceSolutionIds.length + value.referenceDocumentIds.length + value.referenceTextIds.length > 0, "Select at least one Ground Context reference");

/**
 * Kept backward-compatible because saved runs and older callers only contain
 * solution IDs. The schema supplies the newer fields when it accepts input.
 */
export interface GroundContextInput {
  enabled: boolean;
  referenceSolutionIds: string[];
  referenceDocumentIds?: string[];
  referenceTextIds?: string[];
  guidance: string;
  mode?: "manual" | "bundle" | "scope";
  bundleId?: string;
  scope?: { collection?: string; taxonomy?: string };
}
export interface GroundReference {
  id: string;
  sourceType?: "solution" | "document" | "text";
  title: string;
  status: string;
  updated?: string;
  body: string;
  version: string;
  fingerprintVersion?: 2;
  content?: { summary: string; fields: { name: string; text: string }[] };
}
export interface GroundContextSnapshot {
  selection: GroundContextInput;
  references: GroundReference[];
  capturedAt: string;
}
export const emptyGroundSelection: GroundContextInput = { enabled: false, referenceSolutionIds: [], referenceDocumentIds: [], referenceTextIds: [], guidance: "", mode: "manual" };
export function groundIdentity(snapshot?: GroundContextSnapshot): string | undefined {
  if (!snapshot?.selection.enabled) return undefined;
  return JSON.stringify({ guidance: snapshot.selection.guidance, references: snapshot.references.map(r => ({ id: r.id, version: r.version })) });
}

export const groundingReportSchema = z.object({
  evidence: z.array(z.object({
    referenceId: z.string(),
    fieldName: z.string(),
    claim: z.string().min(1),
    quote: z.string().min(12),
  })).max(60),
  issues: z.array(z.string().min(1)).max(20),
});
export type GroundingReport = z.infer<typeof groundingReportSchema>;
