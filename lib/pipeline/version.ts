import { createHash } from "node:crypto";
import type { WSSolution } from "../ra/types";

export function solutionVersion(s: WSSolution): string {
  return createHash("sha256").update(JSON.stringify({ title: s.title, summary: s.summary, template: s.templateName, fields: s.fields, modified: s.lastModifiedDate })).digest("hex");
}
