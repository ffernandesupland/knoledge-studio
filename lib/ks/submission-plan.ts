import type { DecisionSnapshot } from "../db/runs";
import type { WriteOp } from "../pipeline/submit";

/** Same identity on server and client; presentation-only state does not invalidate drafts. */
export function submissionIdentity(plan: WriteOp[], snapshot: DecisionSnapshot, review?: { objectives: unknown[]; restructure: boolean; standards: string[]; snippets?: Record<string, string[]> }): string {
  return JSON.stringify({ plan, groundContextIdentity: snapshot.groundContextIdentity, metadata: snapshot.metadata, collection: snapshot.collection, language: snapshot.language,
    restructure: snapshot.operations.some((o) => o.name === "Restructure content" && o.on),
    standards: review?.standards ?? (snapshot.operations.some((o) => o.name === "Apply content standards" && o.on) ? snapshot.standardsRules : []),
    reviewObjectives: review?.objectives ?? [], reviewRestructure: review?.restructure ?? false, snippets: review?.snippets ?? {} }, (_key, value) => value === false ? undefined : value);
}
