import type { DecisionSnapshot } from "../db/runs";
import type { WriteOp } from "../pipeline/submit";

const configurationStandardMarker = /^\[[^\]\n]+ · [^\]\n]+\]\n/;

/**
 * The browser never receives full configuration documents. Reuse the frozen
 * configuration part of a prepared identity so a stable draft is not marked
 * stale merely because server-only standards/snippets took part in preparation.
 */
export function frozenConfigurationIdentity(identity: string | undefined): { standards: string[]; snippets: Record<string, string[]> } {
  if (!identity) return { standards: [], snippets: {} };
  try {
    const parsed = JSON.parse(identity) as { standards?: unknown; snippets?: unknown };
    const standards = Array.isArray(parsed.standards) ? parsed.standards.filter((value): value is string => typeof value === "string" && configurationStandardMarker.test(value)) : [];
    const snippets = parsed.snippets && typeof parsed.snippets === "object" && !Array.isArray(parsed.snippets) ? parsed.snippets as Record<string, string[]> : {};
    return { standards, snippets };
  } catch { return { standards: [], snippets: {} }; }
}

/** Same identity on server and client; presentation-only state does not invalidate drafts. */
export function submissionIdentity(plan: WriteOp[], snapshot: DecisionSnapshot, review?: { objectives: unknown[]; restructure: boolean; standards: string[]; snippets?: Record<string, string[]> }): string {
  return JSON.stringify({ plan, groundContextIdentity: snapshot.groundContextIdentity, metadata: snapshot.metadata, collection: snapshot.collection, language: snapshot.language,
    restructure: snapshot.operations.some((o) => o.name === "Restructure content" && o.on),
    standards: review?.standards ?? (snapshot.operations.some((o) => o.name === "Apply content standards" && o.on) ? snapshot.standardsRules : []),
    reviewObjectives: review?.objectives ?? [], reviewRestructure: review?.restructure ?? false, snippets: review?.snippets ?? {} }, (_key, value) => value === false ? undefined : value);
}
