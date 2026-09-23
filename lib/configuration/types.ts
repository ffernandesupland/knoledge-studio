import { z } from "zod";

const optionalScopeValue = z.string().trim().min(1).max(500).optional();

export const configurationProfileKindSchema = z.enum(["content_standard", "ground_truth"]);
export type ConfigurationProfileKind = z.infer<typeof configurationProfileKindSchema>;

export const configurationProfileStatusSchema = z.enum(["active", "archived"]);
export type ConfigurationProfileStatus = z.infer<typeof configurationProfileStatusSchema>;

export const configurationScopeSchema = z.object({
  collection: optionalScopeValue,
  taxonomy: optionalScopeValue,
});
export type ConfigurationScope = z.infer<typeof configurationScopeSchema>;

export const configurationSourceSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string().trim().min(1).max(120_000) }),
  z.object({ type: z.literal("document"), documentId: z.string().uuid(), label: z.string().trim().min(1).max(500).optional() }),
  z.object({ type: z.literal("solution"), solutionId: z.string().regex(/^\d{15}$/) }),
]);
export type ConfigurationSource = z.infer<typeof configurationSourceSchema>;

/** Input accepted when an administrator creates or edits a reusable profile. */
export const configurationProfileDraftSchema = z.object({
  kind: configurationProfileKindSchema,
  name: z.string().trim().min(1).max(120),
  scope: configurationScopeSchema.default({}),
  isDefault: z.boolean().default(false),
  guidance: z.string().trim().max(4_000).default(""),
  sources: z.array(configurationSourceSchema).min(1).max(24),
}).superRefine((value, ctx) => {
  const scoped = !!value.scope.collection || !!value.scope.taxonomy;
  if (value.isDefault && scoped) {
    ctx.addIssue({ code: "custom", path: ["scope"], message: "A company default cannot also target a collection or taxonomy." });
  }
  if (!value.isDefault && !scoped) {
    ctx.addIssue({ code: "custom", path: ["scope"], message: "A profile must be the company default or target a collection and/or taxonomy." });
  }
});
export type ConfigurationProfileDraft = z.infer<typeof configurationProfileDraftSchema>;

export interface ConfigurationProfile extends ConfigurationProfileDraft {
  id: string;
  connectionId: string;
  status: ConfigurationProfileStatus;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

/** A target may have several final metadata values; the resolver chooses the most specific match. */
export interface ConfigurationResolutionTarget {
  collections?: string[];
  taxonomies?: string[];
}

export const snippetDraftSchema = z.object({
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().max(2_000).default(""),
  html: z.string().trim().min(1).max(120_000),
  active: z.boolean().default(true),
  scope: configurationScopeSchema.default({}),
});
export type SnippetDraft = z.infer<typeof snippetDraftSchema>;

export interface Snippet extends SnippetDraft {
  id: string;
  connectionId: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export const runConfigurationSnapshotKindSchema = z.enum(["content_standards", "ground_truth", "snippets"]);
export type RunConfigurationSnapshotKind = z.infer<typeof runConfigurationSnapshotKindSchema>;

/** Immutable configuration material captured for a run before any model call can consume it. */
export interface RunConfigurationSnapshot {
  kind: RunConfigurationSnapshotKind;
  capturedAt: string;
  profiles?: ConfigurationProfile[];
  snippets?: Snippet[];
}
