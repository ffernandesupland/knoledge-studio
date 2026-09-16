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
export function referenceFromSolution(solution: WSSolution): GroundReference {
  if (!isLive(solution.status)) throw new Error("Ground Context reference " + solution.id + " must be published.");
  const body = [solution.title, solution.summary, ...(solution.fields ?? []).map(field => field.name + "\n" + plainEvidence(field.content))].filter(Boolean).join("\n\n");
  if (!(solution.fields ?? []).some(field => plainEvidence(field.content)) && !solution.summary?.trim()) throw new Error("Ground Context reference " + solution.id + " has no readable content.");
  return {
    id: solution.id, title: solution.title, status: solution.status, ...(solution.lastModifiedDate ? { updated: solution.lastModifiedDate } : {}),
    body, version: createHash("sha256").update(JSON.stringify({ body, status: solution.status, updated: solution.lastModifiedDate })).digest("hex"),
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
  for (const reference of snapshot.references) {
    const solution = await ra.getSolution(reference.id, { impUser: user });
    if (solution.id !== reference.id || referenceFromSolution(solution).version !== reference.version) {
      throw new Error("Ground Context reference " + reference.id + " changed. Return to Content and analyze again before preparing or submitting.");
    }
  }
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