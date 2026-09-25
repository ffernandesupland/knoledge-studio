import { describe, expect, it } from "vitest";
import { runSchema } from "./validation";

const first = "260909000000001";
const second = "260909000000002";

describe("manual merge input validation", () => {
  it("accepts two existing solutions when the Merge solutions action is selected", () => {
    expect(runSchema.safeParse({ text: "", sourceSolutionIds: [first, second], operations: ["Merge solutions", "Restructure content", "Apply content standards"], path: "improve" }).success).toBe(true);
  });

  it("rejects a one-solution merge, new content, and split-like operations", () => {
    const merge = ["Merge solutions"];
    expect(runSchema.safeParse({ text: "", sourceSolutionIds: [first], operations: merge, path: "improve" }).success).toBe(false);
    expect(runSchema.safeParse({ text: "New source", sourceSolutionIds: [first, second], operations: merge, path: "improve" }).success).toBe(false);
    expect(runSchema.safeParse({ text: "", sourceSolutionIds: [first, second], operations: [...merge, "Split topics"], path: "improve" }).success).toBe(false);
  });
});
