import { z } from "zod";
import { getConfigurationDocument } from "../configuration/documents";
import { resolveConfigurationProfile } from "../configuration/resolver";
import type { CapturedConfigurationProfile, CapturedConfigurationSnapshot } from "../configuration/snapshots";
import { resolveGroundContext } from "./server";
import type { GroundContextInput, GroundContextSnapshot, GroundReference } from "./types";

const scopeSchema = z.object({ collection: z.string().trim().min(1).max(500).optional(), taxonomy: z.string().trim().min(1).max(500).optional() });
export const groundTruthSelectionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("manual"), solutionIds: z.array(z.string().regex(/^\d{15}$/)).max(8).default([]), documentIds: z.array(z.string().uuid()).max(8).default([]), guidance: z.string().trim().max(1000).default("") }).refine(value => value.solutionIds.length + value.documentIds.length > 0, "Select at least one solution or document."),
  z.object({ mode: z.literal("bundle"), bundleId: z.string().uuid(), guidance: z.string().trim().max(1000).default("") }),
  z.object({ mode: z.literal("scope"), scope: scopeSchema, guidance: z.string().trim().max(1000).default("") }).refine(value => !!value.scope.collection || !!value.scope.taxonomy, "Choose a collection, taxonomy, or both."),
]);
export type GroundTruthSelection = z.infer<typeof groundTruthSelectionSchema>;

function profileReference(profile: CapturedConfigurationProfile, source: CapturedConfigurationProfile["sources"][number], index: number): GroundReference {
  const sourceType = source.type === "solution" ? "solution" : source.type === "document" ? "document" : "text";
  return { id: source.sourceId ?? `${profile.id}:source:${index}`, sourceType, title: source.label, status: `Ground Truth bundle: ${profile.name}`, body: source.content, version: source.version };
}
function profileSelection(profile: CapturedConfigurationProfile, guidance: string, mode: "bundle" | "scope", scope?: GroundContextInput["scope"]): GroundContextInput {
  const references = profile.sources;
  return {
    enabled: true,
    referenceSolutionIds: references.flatMap(source => source.type === "solution" && source.sourceId ? [source.sourceId] : []),
    referenceDocumentIds: references.flatMap(source => source.type === "document" && source.sourceId ? [source.sourceId] : []),
    referenceTextIds: references.flatMap((source, index) => source.type === "text" ? [`${profile.id}:source:${index}`] : []),
    guidance: [profile.guidance, guidance].filter(Boolean).join("\n\n"),
    mode,
    bundleId: profile.id,
    ...(scope ? { scope } : {}),
  };
}
function snapshotFromProfile(profile: CapturedConfigurationProfile, guidance: string, mode: "bundle" | "scope", scope?: GroundContextInput["scope"]): GroundContextSnapshot {
  return { selection: profileSelection(profile, guidance, mode, scope), references: profile.sources.map((source, index) => profileReference(profile, source, index)), capturedAt: new Date().toISOString() };
}

export async function resolveGroundTruthSelection(selection: GroundTruthSelection, snapshot: CapturedConfigurationSnapshot, connectionId: string, sourceSolutionIds: string[], user: string): Promise<GroundContextSnapshot> {
  if (selection.mode === "bundle") {
    const profile = snapshot.profiles.find(item => item.id === selection.bundleId);
    if (!profile) throw new Error("The selected Ground Truth bundle is unavailable or was archived before this run started.");
    return snapshotFromProfile(profile, selection.guidance, "bundle");
  }
  if (selection.mode === "scope") {
    const profile = resolveConfigurationProfile(snapshot.profiles, { collections: selection.scope.collection ? [selection.scope.collection] : [], taxonomies: selection.scope.taxonomy ? [selection.scope.taxonomy] : [] });
    if (!profile) throw new Error("No Ground Truth bundle matches this scope and no company default is configured.");
    return snapshotFromProfile(profile.profile, selection.guidance, "scope", selection.scope);
  }
  if (selection.solutionIds.some(id => sourceSolutionIds.includes(id))) throw new Error("A solution cannot be both a processing target and a Ground Truth reference.");
  const base = await resolveGroundContext({ enabled: true, referenceSolutionIds: selection.solutionIds, referenceDocumentIds: selection.documentIds, referenceTextIds: [], guidance: selection.guidance, mode: "manual" }, sourceSolutionIds, user);
  const documents = await Promise.all(selection.documentIds.map(async id => {
    const document = await getConfigurationDocument(id, connectionId);
    return { id: document.id, sourceType: "document" as const, title: document.name, status: "Manual Ground Truth document", body: document.extractedText, version: document.createdAt };
  }));
  const references = [...(base?.references ?? []), ...documents];
  if (references.reduce((total, reference) => total + reference.body.length, 0) > 120_000) throw new Error("Ground Truth exceeds 120,000 characters. Select fewer or shorter sources.");
  return { selection: { ...base!.selection, referenceDocumentIds: selection.documentIds, mode: "manual" }, references, capturedAt: new Date().toISOString() };
}
