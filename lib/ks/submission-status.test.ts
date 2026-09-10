import { describe, expect, it } from "vitest";
import { submissionStatus } from "./submission-status";
import type { WriteOp } from "../pipeline/submit";
import type { OpResult } from "../pipeline/execute";

const plan: WriteOp[] = [
  { kind: "create", candidateKey: "c1", title: "Article", templateName: "How To (RA)", fields: [], idempotencyKey: "article" },
  { kind: "flag", solutionId: "260909000000001", survivorKey: "c1", survivorLabel: "Article", idempotencyKey: "comment" },
];
const result = (key: string, outcome: OpResult["outcome"]): OpResult => ({ idempotencyKey: key, kind: key === "comment" ? "flag" : "create", description: key, outcome });
describe("submission completion", () => {
  it("does not finish an empty plan or a prepared draft", () => {
    expect(submissionStatus([], []).complete).toBe(false);
    expect(submissionStatus(plan, [result("article", "ready")])).toMatchObject({ complete: false, articlesSaved: 0, submitLabel: "Submit reviewed drafts" });
  });
  it("retries comments without presenting a second article submission", () => {
    expect(submissionStatus(plan, [result("article", "ok"), result("comment", "error")])).toMatchObject({ complete: false, articlesSaved: 1, pendingArticles: 0, pendingComments: 1, submitLabel: "Retry pending comments" });
  });
  it("finishes only when all planned operations succeeded", () => {
    expect(submissionStatus(plan, [result("article", "ok"), result("comment", "ok")]).complete).toBe(true);
    expect(submissionStatus(plan, [result("article", "ok"), result("unrelated", "ok")]).complete).toBe(false);
  });
  it("calls for verification when a write has an uncertain outcome", () => {
    expect(submissionStatus(plan, [result("article", "uncertain"), result("comment", "skipped")])).toMatchObject({ complete: false, uncertain: 1, submitLabel: "Verify pending writes" });
  });
});
