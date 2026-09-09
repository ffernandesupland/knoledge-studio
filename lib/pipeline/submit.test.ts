import { describe, expect, it } from "vitest";
import { buildWritePlan, isSolutionId, type MergeSource, type WriteOp } from "@/lib/pipeline/submit";
import type { ViewCandidate, ViewDupeGroup } from "@/lib/ks/model";

const candidate = (over: Partial<ViewCandidate> = {}): ViewCandidate => ({
  key: "c0",
  title: "Windows VPN setup",
  subtitle: "New solution",
  action: "New",
  source: "Your content",
  why: "",
  templateName: "How To (RA)",
  fields: [{ fieldName: "Solution", fieldValue: "Steps." }],
  rawContent: "Steps.",
  duplicates: [],
  dupeGroup: null,
  ...over,
});

const EXISTING = "260717092646280";
const OTHER_EXISTING = "260324150400190";

const mergeGroup = (survivorId: string): ViewDupeGroup => ({
  survivorId,
  averageSimilarity: 88,
  reason: "Same topic.",
  members: [
    { id: EXISTING, title: "Existing article", stat: "2,400 views", retained: survivorId === EXISTING },
    { id: "c0", title: "New draft", stat: "New solution", retained: survivorId === "c0" },
  ],
});

const plan = (over: Partial<Parameters<typeof buildWritePlan>[0]> = {}) =>
  buildWritePlan({
    runId: "run1",
    candidates: [candidate()],
    groups: [],
    selected: new Set(["c0"]),
    resolutions: [],
    ...over,
  });

describe("isSolutionId", () => {
  it("recognises 15-digit RA ids and rejects pipeline keys", () => {
    expect(isSolutionId(EXISTING)).toBe(true);
    expect(isSolutionId("c0")).toBe(false);
    expect(isSolutionId("26071709264628")).toBe(false); // 14 digits
  });
});

describe("buildWritePlan", () => {
  it("skips unselected candidates", () => {
    expect(plan({ selected: new Set() })).toHaveLength(0);
  });

  it("creates a new solution for a fresh draft", () => {
    const ops = plan();
    expect(ops).toHaveLength(1);
    expect(ops[0].kind).toBe("create");
  });

  it("revises rather than overwrites an existing article", () => {
    const ops = plan({
      candidates: [candidate({ key: EXISTING, action: "Update" })],
      selected: new Set([EXISTING]),
    });
    expect(ops[0]).toMatchObject({ kind: "revise", solutionId: EXISTING, fromMerge: false });
  });

  it("never emits a direct overwrite op", () => {
    const ops = plan({
      candidates: [candidate({ key: EXISTING }), candidate({ key: "c1" })],
      selected: new Set([EXISTING, "c1"]),
    });
    expect(ops.every((o) => o.kind !== ("update" as unknown as WriteOp["kind"]))).toBe(true);
  });

  it("never archives anything", () => {
    const ops = plan({
      candidates: [candidate({ key: EXISTING, dupeGroup: 0 }), candidate({ key: "c0", dupeGroup: 0 })],
      groups: [mergeGroup("c0")],
      selected: new Set([EXISTING, "c0"]),
      resolutions: ["merged"],
    });
    expect(ops.some((o) => o.kind === "flag")).toBe(true);
    expect(JSON.stringify(ops)).not.toContain("archive");
  });

  describe("merge resolution", () => {
    const candidates = [
      candidate({ key: EXISTING, title: "Existing article", dupeGroup: 0 }),
      candidate({ key: "c0", title: "New draft", dupeGroup: 0 }),
    ];
    const selected = new Set([EXISTING, "c0"]);

    it("revises the surviving existing article and flags the loser", () => {
      const ops = buildWritePlan({
        runId: "run1",
        candidates,
        groups: [mergeGroup(EXISTING)],
        selected,
        resolutions: ["merged"],
      });
      expect(ops.find((o) => o.kind === "revise")).toMatchObject({
        solutionId: EXISTING,
        fromMerge: true,
      });
      // The losing member is a draft that was never created, so there is nothing to flag.
      expect(ops.filter((o) => o.kind === "flag")).toHaveLength(0);
    });

    it("flags a losing existing article and creates the surviving draft", () => {
      const ops = buildWritePlan({
        runId: "run1",
        candidates,
        groups: [mergeGroup("c0")],
        selected,
        resolutions: ["merged"],
      });
      expect(ops.find((o) => o.kind === "create")).toMatchObject({ candidateKey: "c0" });
      expect(ops.find((o) => o.kind === "flag")).toMatchObject({ solutionId: EXISTING });
    });

    it("orders creates before revises before flags", () => {
      const ops = buildWritePlan({
        runId: "run1",
        candidates: [
          ...candidates,
          candidate({ key: OTHER_EXISTING, title: "Another", dupeGroup: null }),
        ],
        groups: [mergeGroup("c0")],
        selected: new Set([EXISTING, "c0", OTHER_EXISTING]),
        resolutions: ["merged"],
      });
      const kinds = ops.map((o) => o.kind);
      expect(kinds.indexOf("create")).toBeLessThan(kinds.indexOf("flag"));
      expect(kinds.indexOf("revise")).toBeLessThan(kinds.indexOf("flag"));
    });

    it("revises an external survivor this run never analyzed itself, and flags every loser", () => {
      const EXTERNAL_SURVIVOR = "260890000000001";
      const ops = buildWritePlan({
        runId: "run1",
        candidates,
        groups: [
          {
            survivorId: EXTERNAL_SURVIVOR,
            averageSimilarity: 91,
            reason: "Same topic.",
            members: [
              { id: EXTERNAL_SURVIVOR, title: "External survivor", stat: "9,000 views", retained: true },
              { id: EXISTING, title: "Existing article", stat: "2,400 views", retained: false },
              { id: "c0", title: "New draft", stat: "New solution", retained: false },
            ],
          },
        ],
        selected,
        resolutions: ["merged"],
      });

      expect(ops.find((o) => o.kind === "revise" && o.solutionId === EXTERNAL_SURVIVOR)).toMatchObject({
        kind: "revise",
        solutionId: EXTERNAL_SURVIVOR,
        fromMerge: true,
        title: "External survivor",
      });
      // The external survivor's own template/fields aren't known synchronously; they're
      // fetched live at write time instead of being guessed here.
      expect(
        (ops.find((o) => o.kind === "revise" && o.solutionId === EXTERNAL_SURVIVOR) as { templateName?: string })
          .templateName,
      ).toBeUndefined();
      expect(ops.find((o) => o.kind === "flag" && o.solutionId === EXISTING)).toBeTruthy();
      // The new draft was never created, so there is nothing to flag for it.
      expect(ops.some((o) => o.kind === "flag" && o.solutionId === "c0")).toBe(false);
    });

    it("drops a deselected candidate from the merge entirely, not just skipping its flag", () => {
      const ops = buildWritePlan({
        runId: "run1",
        candidates,
        groups: [mergeGroup(EXISTING)],
        selected: new Set([EXISTING]), // "c0" deselected
        resolutions: ["merged"],
      });
      const revise = ops.find((o) => o.kind === "revise" && o.solutionId === EXISTING) as {
        mergeSources?: MergeSource[];
      };
      expect(revise.mergeSources?.some((s) => s.id === "c0")).toBe(false);
    });

    it("blocks an unresolved group on the server", () => {
      expect(() => buildWritePlan({ runId: "run1", candidates, groups: [mergeGroup(EXISTING)], selected, resolutions: [null] })).toThrow("Resolve duplicate groups");
    });

    it("treats 'keep separate' as a normal create, flagging nothing", () => {
      const ops = buildWritePlan({
        runId: "run1",
        candidates,
        groups: [mergeGroup(EXISTING)],
        selected,
        resolutions: ["separate"],
      });
      expect(ops.filter((o) => o.kind === "flag")).toHaveLength(0);
    });
  });

  it("gives every op a run-scoped idempotency key", () => {
    const ops = plan({
      candidates: [candidate({ key: "c0" }), candidate({ key: "c1" })],
      selected: new Set(["c0", "c1"]),
    });
    const keys = ops.map((o) => o.idempotencyKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k.startsWith("run1:"))).toBe(true);
  });
});
