import { describe, expect, it } from "vitest";
import { runSchema } from "./validation";

const first = "260909000000001";
const second = "260909000000002";

describe("manual merge input validation", () => {
  it("accepts two existing solutions with merge-safe operations only", () => {
    expect(runSchema.safeParse({ text: "", sourceSolutionIds: [first, second], operations: ["Restructure content", "Apply content standards"], path: "merge" }).success).toBe(true);
  });

  it("rejects a one-solution merge, new content, and split-like operations", () => {
    expect(runSchema.safeParse({ text: "", sourceSolutionIds: [first], operations: [], path: "merge" }).success).toBe(false);
    expect(runSchema.safeParse({ text: "New source", sourceSolutionIds: [first, second], operations: [], path: "merge" }).success).toBe(false);
    expect(runSchema.safeParse({ text: "", sourceSolutionIds: [first, second], operations: ["Split topics"], path: "merge" }).success).toBe(false);
  });
});
