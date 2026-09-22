import { describe, expect, it } from "vitest";
import { applicableDirectives, demandDirectives, hasDemandRequirements, reviewDirectives } from "./spec";

describe("demand requirements", () => {
  it("turns a saved operator brief into stage-scoped guidance", () => {
    const directives = demandDirectives({
      version: 1,
      intent: "Create a field-technician procedure.",
      directives: [{ id: "operator-1", text: "Use numbered steps.", priority: "required", appliesTo: ["author", "standards"] }],
    });

    expect(directives).toHaveLength(2);
    expect(applicableDirectives(directives, "author").map((directive) => directive.text)).toEqual(["Create a field-technician procedure.", "Use numbered steps."]);
    expect(applicableDirectives(directives, "merge").map((directive) => directive.text)).toEqual(["Create a field-technician procedure."]);
  });

  it("does not treat an empty brief as a requirement", () => {
    expect(hasDemandRequirements({ version: 1, intent: "  ", directives: [] })).toBe(false);
  });

  it("preserves an author-confirmed review resolution as guidance", () => {
    const directives = reviewDirectives([{ key: "review-0", label: "Version conflict", instruction: "Use the selected product version.", findingIndexes: [0], evidence: [], disposition: "custom", resolution: { choice: "Current release", finalInformation: "Applies to release 4.2 only.", answeredAt: "2026-09-22T00:00:00.000Z" } }]);

    expect(directives[0].text).toContain("Applies to release 4.2 only.");
  });
});
