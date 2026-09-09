import { describe, expect, it } from "vitest";
import {
  ksArchSummary,
  ksCheckGate,
  ksComputeSubmitItems,
  ksDupTier,
  ksSubmitStatus,
  type DupeResolution,
} from "@/lib/ks/helpers";
import { mapRunToView, type ViewCandidate, type ViewDupeGroup } from "@/lib/ks/model";
import type { RunOutput } from "@/lib/pipeline/run";

const candidate = (over: Partial<ViewCandidate> = {}): ViewCandidate => ({
  key: "c0",
  title: "Windows VPN setup",
  subtitle: "New solution",
  action: "New",
  source: "Your content",
  why: "Found in the content you pasted.",
  templateName: "How To (RA)",
  fields: [],
  rawContent: "",
  duplicates: [],
  dupeGroup: null,
  ...over,
});

const group = (over: Partial<ViewDupeGroup> = {}): ViewDupeGroup => ({
  survivorId: "000000000000001",
  averageSimilarity: 88,
  reason: "Same topic.",
  members: [
    { id: "000000000000001", title: "Existing article", stat: "2,400 views", retained: true },
    { id: "c0", title: "Windows VPN setup", stat: "New solution · no history yet", retained: false },
  ],
  ...over,
});

describe("ksDupTier", () => {
  it("maps scores to severity bands", () => {
    expect(ksDupTier(88)).toBe("hi");
    expect(ksDupTier(80)).toBe("hi");
    expect(ksDupTier(79)).toBe("med");
    expect(ksDupTier(55)).toBe("med");
    expect(ksDupTier(54)).toBe("low");
  });
});

describe("ksCheckGate", () => {
  it("blocks when nothing is selected", () => {
    expect(ksCheckGate([candidate()], [], new Set(), []).ok).toBe(false);
  });

  it("blocks while a selected group is unresolved", () => {
    const c = candidate({ dupeGroup: 0 });
    const gate = ksCheckGate([c], [group()], new Set(["c0"]), [null]);
    expect(gate.ok).toBe(false);
    expect(gate.msg).toContain("Resolve 1 set");
  });

  it("pluralises multiple unresolved groups", () => {
    const cs = [candidate({ key: "c0", dupeGroup: 0 }), candidate({ key: "c1", dupeGroup: 1 })];
    const gate = ksCheckGate(cs, [group(), group()], new Set(["c0", "c1"]), [null, null]);
    expect(gate.msg).toContain("Resolve 2 sets");
  });

  it("passes once every selected group is resolved", () => {
    const c = candidate({ dupeGroup: 0 });
    const gate = ksCheckGate([c], [group()], new Set(["c0"]), ["merged"]);
    expect(gate.ok).toBe(true);
    expect(gate.msg).toBe("1 of 1 selected");
  });

  it("ignores groups whose members are all deselected", () => {
    const cs = [candidate({ key: "c0" }), candidate({ key: "c1", dupeGroup: 0 })];
    expect(ksCheckGate(cs, [group()], new Set(["c0"]), [null]).ok).toBe(true);
  });
});

describe("ksSubmitStatus", () => {
  const merged: DupeResolution[] = ["merged"];

  it("marks the survivor as merged", () => {
    const c = candidate({ key: "000000000000001", dupeGroup: 0 });
    expect(ksSubmitStatus(c, [group()], merged)).toBe("merged");
  });

  it("flags non-survivors rather than archiving them", () => {
    const c = candidate({ key: "c0", dupeGroup: 0 });
    expect(ksSubmitStatus(c, [group()], merged)).toBe("flagged");
  });

  it("treats an unresolved knowledge-base candidate as an update", () => {
    const c = candidate({ action: "Update" });
    expect(ksSubmitStatus(c, [], [])).toBe("updated");
  });

  it("treats gap suggestions as new", () => {
    expect(ksSubmitStatus(candidate({ source: "Find gaps" }), [], [])).toBe("new");
  });
});

describe("ksComputeSubmitItems", () => {
  it("only includes selected candidates", () => {
    const cs = [candidate({ key: "c0" }), candidate({ key: "c1" })];
    expect(ksComputeSubmitItems(cs, [], new Set(["c0"]), [])).toHaveLength(1);
  });

  it("labels the survivor and exposes an edit target", () => {
    const c = candidate({ key: "000000000000001", title: "Existing article", dupeGroup: 0 });
    const items = ksComputeSubmitItems([c], [group()], new Set([c.key]), ["merged"]);
    expect(items[0].name).toBe("Existing article (retained)");
    expect(items[0].editTarget).toBe("000000000000001");
  });

  it("describes flagged candidates as kept in place", () => {
    const c = candidate({ key: "c0", dupeGroup: 0 });
    const items = ksComputeSubmitItems([c], [group()], new Set(["c0"]), ["merged"]);
    expect(items[0].change).toContain("stays in place");
  });
});

describe("ksArchSummary", () => {
  it("counts outcomes and captions by source", () => {
    const cs = [
      candidate({ key: "000000000000001", dupeGroup: 0 }),
      candidate({ key: "c0", dupeGroup: 0 }),
    ];
    const selected = new Set(cs.map((c) => c.key));
    const items = ksComputeSubmitItems(cs, [group()], selected, ["merged"]);
    const summary = ksArchSummary(cs, selected, items);
    expect(summary.counts.merged).toBe(1);
    expect(summary.counts.flagged).toBe(1);
    expect(summary.caption).toContain("from your content");
  });
});

describe("mapRunToView", () => {
  const run: RunOutput = {
    costUsd: 0.02,
    steps: [],
    solutions: [
      {
        key: "c0",
        title: "Windows 11 VPN failure",
        summary: "",
        keywords: [],
        templateName: "Error (RA)",
        fields: [],
        rawContent: "VPN fails to connect on Windows 11.",
        source: "Your content",
        rationale: "Split rationale.",
        duplicates: [
          {
            solutionId: "000000000000001",
            title: "Troubleshoot VPN",
            verdict: "duplicate",
            similarity: 88,
            rationale: "Same problem and resolution.",
            sharedTopics: [],
            viewCount: 2400,
          },
        ],
      },
    ],
    groups: [
      {
        survivorId: "000000000000001",
        averageSimilarity: 88,
        rationales: ["Same problem and resolution."],
        members: [
          { id: "000000000000001", title: "Troubleshoot VPN", isNew: false, viewCount: 2400 },
          { id: "c0", title: "Windows 11 VPN failure", isNew: true, viewCount: 0 },
        ],
      },
    ],
  };

  it("marks grouped candidates as Merge", () => {
    expect(mapRunToView(run).candidates[0].action).toBe("Merge");
  });

  it("keeps the overall topic rationale separate from duplicate evidence", () => {
    expect(mapRunToView(run).candidates[0].why).toBe("Split rationale.");
    expect(mapRunToView(run).candidates[0].duplicates[0].rationale).toBe("Same problem and resolution.");
  });

  it("falls back to the split rationale when there are no duplicates", () => {
    const solo: RunOutput = {
      ...run,
      groups: [],
      solutions: [{ ...run.solutions[0], duplicates: [] }],
    };
    const view = mapRunToView(solo);
    expect(view.candidates[0].why).toBe("Split rationale.");
    expect(view.candidates[0].action).toBe("New");
  });

  it("formats member stats, distinguishing new drafts from existing articles", () => {
    const g = mapRunToView(run).groups[0];
    expect(g.members.find((m) => m.id === "c0")!.stat).toContain("no history yet");
    expect(g.members.find((m) => m.retained)!.stat).toBe("2,400 views");
  });
});
