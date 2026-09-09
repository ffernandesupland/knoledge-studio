import { RaError } from "./http";

/** manageSolution replies in plain text: "Successfully created solution with ID: 260903...". */
export function parseSolutionId(raw: string): string {
  return String(raw).match(/(\d{15})/)?.[1] ?? "";
}

const WRITE_OK = /successfully (created|updated) solution with id/i;

/**
 * manageSolution reports failures as HTTP 200 with a plain-text body
 * ("Could not save solution.User does not have access..."), so status codes alone will
 * silently swallow rejected writes. Verified V9.
 */
export function assertWriteSucceeded(raw: string): string {
  if (!WRITE_OK.test(String(raw))) {
    throw new RaError(
      `manageSolution rejected: ${String(raw).trim()}`,
      200,
      "/api/rest/manageSolution",
      String(raw).slice(0, 300),
    );
  }
  return raw;
}

/**
 * `revisionID` encodes the link as `child<id>` on a parent or `parent<id>` on a revision.
 * A parent may only ever have one pending revision (verified V16).
 */
export function parseRevisionLink(
  revisionID: string | null | undefined,
): { role: "parent" | "child"; id: string } | null {
  if (!revisionID) return null;
  const m = /^(child|parent)(\d{15})$/.exec(revisionID.trim());
  if (!m) return null;
  return { role: m[1] as "parent" | "child", id: m[2] };
}

/** The id of the pending revision hanging off this solution, if it has one. */
export function pendingRevisionId(revisionID: string | null | undefined): string | null {
  const link = parseRevisionLink(revisionID);
  return link?.role === "child" ? link.id : null;
}
