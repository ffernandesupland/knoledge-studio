/**
 * RightAnswers uses two different status vocabularies: reads return capitalised display
 * values ("Published", "Draft"), while manageSolution accepts lowercase write values
 * ("approved", "draft", ...). Verified against the QA tenant 2026-09-03 — see
 * ARCHITECTURE.md §4.5 finding V2. Matching a read value against the write vocabulary
 * silently never fires, which would let us direct-edit live articles.
 */

export type WriteStatus = "approved" | "noapproved" | "draft" | "review" | "archived";

export type ReadStatus =
  | "Published"
  | "Not Approved"
  | "Draft"
  | "In Review"
  | "Archived"
  | "Deleted";

const READ_TO_WRITE: Record<string, WriteStatus> = {
  published: "approved",
  approved: "approved",
  "not approved": "noapproved",
  noapproved: "noapproved",
  draft: "draft",
  "in review": "review",
  review: "review",
  archived: "archived",
};

export function toWriteStatus(readStatus: string | null | undefined): WriteStatus | null {
  if (!readStatus) return null;
  return READ_TO_WRITE[readStatus.trim().toLowerCase()] ?? null;
}

/**
 * True when the solution is live to end users, and therefore must be edited via
 * revisionParentID rather than a direct write.
 */
export function isLive(readStatus: string | null | undefined): boolean {
  return toWriteStatus(readStatus) === "approved";
}
