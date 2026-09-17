import { createHash } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { ra } from "../ra/client";
import { isLive } from "../ra/status";
import type { WSSolution } from "../ra/types";
import type { WriteOp } from "../pipeline/submit";
import { groundContextSchema, type GroundContextInput, type GroundContextSnapshot, type GroundReference } from "./types";

export function plainEvidence(value: string): string {
  return sanitizeHtml(value, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
}
const normalize = (text: string) => plainEvidence(text).normalize("NFC");
function referenceFingerprint(title: string, summary: string, fields: { name: string; text: string }[]) {
  return createHash("sha256").update(JSON.stringify({ title: normalize(title), summary: normalize(summary),
    fields: fields.map(f => ({ name: normalize(f.name), text: normalize(f.text) })).sort((a, b) => a.name.localeCompare(b.name) || a.text.localeCompare(b.text)) })).digest("hex");
}
export interface ReferenceChange { id: string; title: string; reason: string; savedUpdated?: string; currentUpdated?: string; savedBody: string; currentBody?: string }
function changedContent(saved: GroundReference, current: GroundReference): string[] {
  if (!saved.content || !current.content) return [];
  const changes: string[] = [];
  if (normalize(saved.title) !== normalize(current.title)) changes.push("title");
  if (normalize(saved.content.summary) !== normalize(current.content.summary)) changes.push("summary");
  const names = new Set([...saved.content.fields, ...current.content.fields].map(f => normalize(f.name)));
  for (const name of names) {
    const values = (reference: GroundReference) => reference.content!.fields.filter(f => normalize(f.name) === name).map(f => normalize(f.text)).sort();
    if (JSON.stringify(values(saved)) !== JSON.stringify(values(current))) changes.push(`field: ${name}`);
  }
  return changes;
}
export class GroundReferenceChangedError extends Error {
  constructor(public changes: ReferenceChange[]) {
    super(`Reference knowledge needs attention: ${changes.map(c => `${c.title} (${c.id}): ${c.reason}`).join("; ")}. Review the changes, then return to Content and analyze again. Your saved drafts remain available.`);
    this.name = "GroundReferenceChangedError";
  }
}
export function referenceFromSolution(solution: WSSolution): GroundReference {
  if (!isLive(solution.status)) throw new Error("Ground Context reference " + solution.id + " must be published.");
  const body = [solution.title, solution.summary, ...(solution.fields ?? []).map(field => field.name + "\n" + plainEvidence(field.content))].filter(Boolean).join("\n\n");
  if (!(solution.fields ?? []).some(field => plainEvidence(field.content)) && !solution.summary?.trim()) throw new Error("Ground Context reference " + solution.id + " has no readable content.");
  const content = { summary: solution.summary ?? "", fields: (solution.fields ?? []).map(f => ({ name: f.name, text: plainEvidence(f.content) })) };
  return {
    id: solution.id, title: solution.title, status: solution.status, ...(solution.lastModifiedDate ? { updated: solution.lastModifiedDate } : {}),
    body, content, fingerprintVersion: 2, version: referenceFingerprint(solution.title, content.summary, content.fields),
  };
}
export async function resolveGroundContext(input?: GroundContextInput, sourceIds: string[] = [], user?: string): Promise<GroundContextSnapshot | undefined> {
  if (!input) return undefined;
  const selection = groundContextSchema.parse(input);
  if (!selection.enabled) return { selection, references: [], capturedAt: new Date().toISOString() };
  if (selection.referenceSolutionIds.some(id => sourceIds.includes(id))) throw new Error("A solution cannot be both a processing target and a Ground Context reference.");
  const references: GroundReference[] = [];
  for (const id of selection.referenceSolutionIds) {
    const solution = await ra.getSolution(id, { impUser: user });
    if (solution.id !== id) throw new Error("Reference retrieval returned a different solution.");
    references.push(referenceFromSolution(solution));
    if (references.reduce((length, reference) => length + reference.body.length, 0) > 120_000) throw new Error("Ground Context exceeds 120,000 characters. Select fewer or shorter references.");
  }
  return { selection, references, capturedAt: new Date().toISOString() };
}
/** Checks current access and content before preparation and before any write. */
export async function assertGroundReferencesCurrent(snapshot: GroundContextSnapshot | undefined, user: string) {
  if (!snapshot?.selection.enabled) return;
  const changes: ReferenceChange[] = [];
  for (const reference of snapshot.references) {
    try {
      const solution = await ra.getSolution(reference.id, { impUser: user });
      if (solution.id !== reference.id) throw new Error("Retrieved a different solution");
      const current = referenceFromSolution(solution);
      // Legacy snapshots contain the exact model input. Compare it conservatively;
      // never reinterpret an old hash as a new fingerprint or silently replace evidence.
      const same = reference.fingerprintVersion === 2 ? current.version === reference.version : normalize(current.body) === normalize(reference.body);
      if (!same) {
        const fields = changedContent(reference, current);
        changes.push({ id: reference.id, title: reference.title, reason: `Reference content changed${fields.length ? ` (${fields.join(", ")})` : ""}`, savedUpdated: reference.updated, currentUpdated: current.updated, savedBody: reference.body, currentBody: current.body });
      }
    } catch (error) {
      changes.push({ id: reference.id, title: reference.title, reason: error instanceof Error ? error.message : "Reference is unavailable", savedUpdated: reference.updated, savedBody: reference.body });
    }
  }
  if (changes.length) throw new GroundReferenceChangedError(changes);
}
export function assertReferenceOnlyPlan(plan: WriteOp[], snapshot?: GroundContextSnapshot) {
  if (!snapshot?.selection.enabled) return;
  const ids = new Set(snapshot.references.map(reference => reference.id));
  for (const op of plan) {
    if ((op.kind !== "create" && ids.has(op.solutionId)) ||
        (op.kind !== "flag" && (ids.has(op.candidateKey) || op.mergeSources?.some(source => ids.has(source.id))))) {
      throw new Error("Ground Context references cannot be written, merged, or flagged.");
    }
  }
}
