import { describe, expect, it } from "vitest";
import { buildDuplicateGroups } from "@/lib/pipeline/grouping";
import { solutionToText } from "@/lib/pipeline/dedupe";
import type { DuplicateMatch } from "@/lib/pipeline/dedupe";

const match = (over: Partial<DuplicateMatch> = {}): DuplicateMatch => ({
  solutionId: "000000000000001",
  title: "Existing article",
  verdict: "duplicate",
  sameUserNeed: true,
  similarity: 90,
  rationale: "Same problem and resolution.",
  sharedTopics: ["vpn"],
  viewCount: 100,
  ...over,
});

describe("buildDuplicateGroups", () => {
  it("keeps different reader needs separate despite high model similarity", () => {
    const candidates = [{ key: "c0", title: "Tool inventory" }, { key: "c1", title: "Configure tools" }];
    expect(buildDuplicateGroups({ candidates, matchesByCandidate: { c0: [match({ sameUserNeed: false, similarity: 98 })] }, intraBatchPairs: [{ aIndex: 0, bIndex: 1, sameUserNeed: false, similarity: 98, rationale: "Shared background; different tasks" }] })).toEqual([]);
    expect(buildDuplicateGroups({ candidates, matchesByCandidate: {}, intraBatchPairs: [{ aIndex: 0, bIndex: 1, sameUserNeed: true, similarity: 90, rationale: "Same task in both bodies" }] })).toHaveLength(1);
  });
  it("returns no group when a candidate has no strong match", () => {
    const groups = buildDuplicateGroups({
      candidates: [{ key: "c1", title: "Windows VPN setup" }],
      matchesByCandidate: { c1: [match({ similarity: 40 })] },
    });
    expect(groups).toHaveLength(0);
  });

  it("does not group merely overlapping articles at luna's calibration", () => {
    // luna scored genuinely-overlapping-but-distinct pairs at 72 on real data.
    const groups = buildDuplicateGroups({
      candidates: [{ key: "c1", title: "Windows 11 VPN failure" }],
      matchesByCandidate: { c1: [match({ similarity: 72 })] },
    });
    expect(groups).toHaveLength(0);
  });

  it("groups a candidate with its matched solution", () => {
    const groups = buildDuplicateGroups({
      candidates: [{ key: "c1", title: "Windows VPN setup" }],
      matchesByCandidate: { c1: [match()] },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].members.map((m) => m.id).sort()).toEqual(["000000000000001", "c1"]);
  });

  it("recommends the most-viewed existing article as survivor", () => {
    const groups = buildDuplicateGroups({
      candidates: [{ key: "c1", title: "Windows VPN setup" }],
      matchesByCandidate: {
        c1: [
          match({ solutionId: "000000000000001", title: "Low traffic", viewCount: 10 }),
          match({ solutionId: "000000000000002", title: "High traffic", viewCount: 2400 }),
        ],
      },
    });
    expect(groups[0].survivorId).toBe("000000000000002");
  });

  it("never picks a brand-new draft over an existing article", () => {
    const groups = buildDuplicateGroups({
      candidates: [{ key: "c1", title: "New draft" }],
      matchesByCandidate: { c1: [match({ viewCount: 0 })] },
    });
    expect(groups[0].survivorId).toBe("000000000000001");
  });

  it("merges transitively: two candidates matching the same solution form one group", () => {
    const groups = buildDuplicateGroups({
      candidates: [
        { key: "c1", title: "A" },
        { key: "c2", title: "B" },
      ],
      matchesByCandidate: { c1: [match()], c2: [match()] },
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].members).toHaveLength(3);
  });

  it("groups two new drafts that only overlap each other", () => {
    const groups = buildDuplicateGroups({
      candidates: [
        { key: "c1", title: "A" },
        { key: "c2", title: "B" },
      ],
      matchesByCandidate: {},
      intraBatchPairs: [{ aIndex: 0, bIndex: 1, sameUserNeed: true, similarity: 85, rationale: "Same topic." }],
    });
    expect(groups).toHaveLength(1);
    expect(groups[0].members.every((m) => m.isNew)).toBe(true);
  });

  it("ignores intra-batch pairs below the threshold", () => {
    const groups = buildDuplicateGroups({
      candidates: [
        { key: "c1", title: "A" },
        { key: "c2", title: "B" },
      ],
      matchesByCandidate: {},
      intraBatchPairs: [{ aIndex: 0, bIndex: 1, sameUserNeed: true, similarity: 20, rationale: "Different." }],
    });
    expect(groups).toHaveLength(0);
  });

  it("averages similarity across the links in a group", () => {
    const groups = buildDuplicateGroups({
      candidates: [{ key: "c1", title: "A" }],
      matchesByCandidate: {
        c1: [
          match({ solutionId: "000000000000001", similarity: 80 }),
          match({ solutionId: "000000000000002", similarity: 90 }),
        ],
      },
    });
    expect(groups[0].averageSimilarity).toBe(85);
  });
});

describe("solutionToText", () => {
  it("flattens title, summary and non-empty fields", () => {
    const text = solutionToText({
      id: "1",
      title: "VPN setup",
      status: "Published",
      summary: "How to connect.",
      fields: [
        { name: "Solution", content: "Step one." },
        { name: "Details", content: "   " },
      ],
    });
    expect(text).toContain("VPN setup");
    expect(text).toContain("## Solution");
    expect(text).not.toContain("## Details");
  });
});
