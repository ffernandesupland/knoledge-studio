import { z } from "zod";

export const groundContextSchema = z.object({
  enabled: z.boolean(),
  referenceSolutionIds: z.array(z.string().regex(/^\d{15}$/)).max(8)
    .refine(ids => new Set(ids).size === ids.length, "Reference IDs must be unique"),
  guidance: z.string().max(1000).default(""),
}).refine(value => !value.enabled || value.referenceSolutionIds.length > 0, "Select at least one Ground Context reference");

export type GroundContextInput = z.infer<typeof groundContextSchema>;
export interface GroundReference {
  id: string;
  title: string;
  status: string;
  updated?: string;
  body: string;
  version: string;
}
export interface GroundContextSnapshot {
  selection: GroundContextInput;
  references: GroundReference[];
  capturedAt: string;
}
export const emptyGroundSelection: GroundContextInput = { enabled: false, referenceSolutionIds: [], guidance: "" };
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