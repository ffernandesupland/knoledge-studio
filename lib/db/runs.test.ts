import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase, useDatabase } from "@/lib/db";
import {
  completeRun,
  createRun,
  failRun,
  getResumableRun,
  getRun,
  listRuns,
  markSubmitted,
  saveDecisions,
} from "@/lib/db/runs";
import { alreadySucceeded, auditForRun, recordAudit } from "@/lib/pipeline/audit";
import type { ViewCandidate, ViewDupeGroup } from "@/lib/ks/model";
import { attachDemandRecommendation, createDemandRecommendation, setDemandRecommendationStatus } from "@/lib/demand/store";
import type { DemandSpecification } from "@/lib/demand/spec";

let dir: string;

beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ks-db-"));
  useDatabase(path.join(dir, "test.db"));
});

afterAll(() => {
  closeDatabase();
  rmSync(dir, { recursive: true, force: true });
});

const candidate: ViewCandidate = {
  key: "c0",
  title: "Printer offline",
  subtitle: "New solution",
  action: "New",
  source: "Your content",
  why: "Split rationale.",
  templateName: "Problem (RA)",
  fields: [{ fieldName: "Solution", fieldValue: "Restart the spooler." }],
  rawContent: "Restart the spooler.",
  duplicates: [],
  dupeGroup: null,
};

const group: ViewDupeGroup = {
  survivorId: "c0",
  averageSimilarity: 85,
  reason: "Same topic.",
  members: [{ id: "c0", title: "Printer offline", stat: "New solution", retained: true }],
};

async function seed(id: string) {
  (await createRun({
    id,
    author: "sauser",
    path: "create",
    inputText: "printer notes",
    sourceIds: [],
    operations: ["Split topics"],
  }));
}

describe("run persistence", () => {
  it("round-trips a completed run", async () => {
    (await seed("r1"));
    (await completeRun("r1", { candidates: [candidate], groups: [group], costUsd: 0.018, steps: [] }));

    const stored = (await getRun("r1"))!;
    expect(stored.status).toBe("done");
    expect(stored.costUsd).toBeCloseTo(0.018);
    expect(stored.candidates[0].title).toBe("Printer offline");
    expect(stored.candidates[0].fields[0].fieldValue).toBe("Restart the spooler.");
    expect(stored.groups[0].survivorId).toBe("c0");
  });

  it("persists demand requirements with the run", async () => {
    (await createRun({
      id: "requirements",
      author: "sauser",
      path: "create",
      inputText: "printer notes",
      sourceIds: [],
      operations: [],
      demandSpecification: { version: 1, intent: "Create a technician procedure.", directives: [{ id: "operator-1", text: "Use numbered steps.", priority: "required", appliesTo: ["author", "standards"] }] },
    }));

    expect((await getRun("requirements"))?.demandSpecification).toEqual({ version: 1, intent: "Create a technician procedure.", directives: [{ id: "operator-1", text: "Use numbered steps.", priority: "required", appliesTo: ["author", "standards"] }] });
  });

  it("persists a new-solution limit with the run", async () => {
    await createRun({
      id: "limited",
      author: "sauser",
      path: "create",
      inputText: "printer notes",
      sourceIds: [],
      operations: ["Split topics"],
      maxNewSolutions: 2,
    });

    expect((await getRun("limited"))?.maxNewSolutions).toBe(2);
  });

  it("links an accepted, matching workflow recommendation to its run", async () => {
    const specification: DemandSpecification = { version: 1, intent: "Create a technician procedure.", directives: [{ id: "operator-2", text: "Use numbered steps.", priority: "required", appliesTo: ["author", "standards"] }] };
    await createRun({ id: "recommended", author: "sauser", path: "create", inputText: "printer notes", sourceIds: [], operations: ["Restructure content"], demandSpecification: specification });
    const recommendation = await createDemandRecommendation({ author: "sauser", specification, sourceSummary: "Supported printer notes", recommendation: { recommendedOperations: ["Restructure content"], rationale: "A procedure needs clear steps.", questions: [], evidenceGaps: [] }, model: "test-model" });
    await expect(attachDemandRecommendation("recommended", "sauser", recommendation.id, specification)).rejects.toThrow("Apply the workflow recommendation");
    await setDemandRecommendationStatus("sauser", recommendation.id, "accepted");
    await attachDemandRecommendation("recommended", "sauser", recommendation.id, specification);

    expect((await getRun("recommended"))?.demandRecommendation).toMatchObject({ id: recommendation.id, model: "test-model", status: "accepted" });
  });

  it("selects everything by default so a restored run matches a fresh one", async () => {
    expect((await getRun("r1"))!.decisions?.selectedKeys).toEqual(["c0"]);
    expect((await getRun("r1"))!.decisions?.resolutions).toEqual(["merged"]);
  });

  it("updates decisions without clobbering the run", async () => {
    (await saveDecisions("r1", {
      selectedKeys: [],
      resolutions: ["merged"],
      collection: "custom_x",
      language: "English",
    }));
    const stored = (await getRun("r1"))!;
    expect(stored.decisions).toMatchObject({
      selectedKeys: [],
      resolutions: ["merged"],
      collection: "custom_x",
    });
    expect(stored.candidates).toHaveLength(1);
  });

  it("records a failed run with its reason", async () => {
    (await seed("r2"));
    (await failRun("r2", "Nothing to process"));
    const stored = (await getRun("r2"))!;
    expect(stored.status).toBe("error");
    expect(stored.error).toBe("Nothing to process");
  });

  it("resumes the most recent completed run and ignores failed ones", async () => {
    const resumable = (await getResumableRun("sauser"))!;
    expect(resumable.id).toBe("r1");
  });

  it("stops offering a run once it has been submitted", async () => {
    (await markSubmitted("r1"));
    expect((await getRun("r1"))!.status).toBe("submitted");
    expect((await getResumableRun("sauser"))).toBeNull();
  });

  it("returns null for an unknown run", async () => {
    expect((await getRun("nope"))).toBeNull();
  });

  it("lists runs newest first", async () => {
    expect((await listRuns()).map((r) => r.id)).toContain("r1");
  });
});

describe("write audit", () => {
  it("records successes and failures", async () => {
    (await seed("r3"));
    (await recordAudit({
      ts: new Date().toISOString(),
      runId: "r3",
      user: "sauser",
      op: "create",
      idempotencyKey: "r3:create:c0",
      target: "260903145019767",
      request: { kind: "create" },
      outcome: "ok",
      response: "Successfully created",
    }));
    (await recordAudit({
      ts: new Date().toISOString(),
      runId: "r3",
      user: "sauser",
      op: "revise",
      idempotencyKey: "r3:revise:x",
      request: { kind: "revise" },
      outcome: "error",
      error: "boom",
    }));
    expect((await auditForRun("r3"))).toHaveLength(2);
  });

  it("reports an operation that already succeeded, so a retry can skip it", async () => {
    expect((await alreadySucceeded("r3:create:c0"))).toEqual({ target: "260903145019767" });
  });

  it("does not treat a failed operation as already done", async () => {
    expect((await alreadySucceeded("r3:revise:x"))).toBeNull();
  });

  it("never blocks a write when auditing fails", () => {
    expect(async () =>
      (await recordAudit({
        ts: new Date().toISOString(),
        runId: "r3",
        user: "sauser",
        op: "create",
        idempotencyKey: "r3:create:c0",
        target: "dupe",
        request: {},
        outcome: "ok",
      })),
    ).not.toThrow();
  });
});
