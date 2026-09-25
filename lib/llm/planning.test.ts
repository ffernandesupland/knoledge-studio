import { describe, expect, it } from "vitest";
import { ProposalSchema } from "./planning";

const proposal = { key: "c0", purpose: "Help the reader", coverage: ["Supported scope"], why: ["The source supports one bounded user need.", "The proposed scope keeps the supported facts together."], rationale: "Supported scope", openQuestions: [] };

describe("content planning reasons", () => {
  it("requires short, structured Why bullets", () => {
    expect(ProposalSchema.safeParse(proposal).success).toBe(true);
    expect(ProposalSchema.safeParse({ ...proposal, why: ["Only one reason"] }).success).toBe(false);
    expect(ProposalSchema.safeParse({ ...proposal, why: Array.from({ length: 6 }, (_, index) => `Reason ${index}`) }).success).toBe(false);
  });
});
