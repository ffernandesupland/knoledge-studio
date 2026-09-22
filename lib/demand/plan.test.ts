import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ operation: vi.fn() }));
vi.mock("../llm/client", () => ({ runOperation: mocks.operation }));

import { recommendDemandPlan } from "./plan";

describe("demand workflow recommendation", () => {
  it("uses a bounded schema and keeps the brief outside the executable task", () => {
    recommendDemandPlan({ version: 1, intent: "Create a technician procedure.", directives: [] }, "Supported source material");

    const args = mocks.operation.mock.calls[0][0];
    expect(args.operation).toBe("demandPlan");
    expect(args.task).toContain("Do not invent operations");
    expect(args.blocks[0]).toMatchObject({ label: expect.stringContaining("not factual evidence") });
    expect(args.schema.safeParse({ recommendedOperations: ["Restructure content"], rationale: "The source requires a structured procedure.", questions: [], evidenceGaps: [] }).success).toBe(true);
    expect(args.schema.safeParse({ recommendedOperations: ["Publish immediately"], rationale: "Unsafe", questions: [], evidenceGaps: [] }).success).toBe(false);
  });
});
