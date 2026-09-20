import { beforeEach, expect, it, vi } from "vitest";
import type { WSSolution } from "../ra/types";
import { solutionVersion } from "../pipeline/version";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), resolveConnection: vi.fn(), getSolution: vi.fn(), runOperation: vi.fn() }));
vi.mock("../db", () => ({ db: () => ({ prepare: mocks.prepare }) }));
vi.mock("../ra/connections", () => ({ resolveConnection: mocks.resolveConnection }));
vi.mock("../ra/client", () => ({ ra: { getSolution: mocks.getSolution } }));
vi.mock("../llm/client", () => ({ runOperation: mocks.runOperation }));

import { createSolutionReviewHandoff, runSolutionReview } from "./solution-reviews";

const solution: WSSolution = {
  id: "170712210507003", title: "Connect to the corporate VPN", status: "Draft", summary: "Connect securely.",
  fields: [{ name: "Resolution", content: "Open the VPN client and approve MFA." }],
};
const definition = { id: "11111111-1111-4111-8111-111111111111", author: "author", connection_id: "connection", name: "Quality", objective: "Identify unclear or unsupported instructions.", created_at: "2026-09-20", updated_at: "2026-09-20" };
let storedReview: unknown;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveConnection.mockResolvedValue({ id: "connection" });
  mocks.getSolution.mockResolvedValue(solution);
  storedReview = undefined;
  mocks.prepare.mockImplementation((sql: string) => ({
    get: vi.fn().mockResolvedValue(sql.startsWith("SELECT * FROM solution_review_definitions") ? definition : sql.startsWith("SELECT * FROM solution_reviews") ? storedReview : undefined),
    run: vi.fn().mockResolvedValue({ changes: 1 }),
  }));
});

it("runs a customer objective as bounded analytic scope and retains exact evidence", async () => {
  mocks.runOperation.mockResolvedValue({ data: { summary: "One concern.", findings: [{ title: "MFA detail", category: "clarity", severity: "medium", summary: "The MFA step is brief.", recommendation: "Add the expected approval behaviour.", evidence: [{ fieldName: "Resolution", quote: "approve MFA" }], confidence: 0.9 }], limitations: [] } });
  const review = await runSolutionReview("author", { connectionId: "connection", solutionId: solution.id, definitionId: definition.id });
  expect(review.status).toBe("completed");
  expect(review.result?.findings[0].evidence[0].quote).toBe("approve MFA");
  const input = mocks.runOperation.mock.calls[0][0];
  expect(input.operation).toBe("solutionReview");
  expect(input.blocks[0]).toMatchObject({ label: "customer review objective", content: definition.objective });
  expect(input.task).toContain("never a direct write instruction");
});

it("rejects a model citation that is not present in the saved source", async () => {
  mocks.runOperation.mockResolvedValue({ data: { summary: "One concern.", findings: [{ title: "Invented", category: "clarity", severity: "high", summary: "Unsupported.", recommendation: "Verify.", evidence: [{ fieldName: "Resolution", quote: "a sentence that does not exist" }], confidence: 0.8 }], limitations: [] } });
  await expect(runSolutionReview("author", { connectionId: "connection", solutionId: solution.id, definitionId: definition.id })).rejects.toThrow("does not match");
});

it("maps a selected review finding to a closed native operation and preserves its scope guidance", async () => {
  storedReview = {
    id: "22222222-2222-4222-8222-222222222222", author: "author", connection_id: "connection", solution_id: solution.id,
    source_version: solutionVersion(solution), definition_id: definition.id, status: "completed",
    result: JSON.stringify({ summary: "Duplicate concern.", findings: [{ title: "Overlap", category: "Potential duplicate", severity: "medium", summary: "Similar content exists.", recommendation: "Compare the overlapping solution before merging.", evidence: [{ fieldName: "Resolution", quote: "approve MFA" }], confidence: 0.8 }], limitations: [] }),
    error: null, created_at: "2026-09-20", completed_at: "2026-09-20",
  };
  const handoff = await createSolutionReviewHandoff("author", (storedReview as { id: string }).id, [0]);
  expect(handoff.nativeOperations).toEqual(["Find duplicates"]);
  expect(handoff.reviewObjectives[0]).toMatchObject({ disposition: "native", instruction: "Compare the overlapping solution before merging." });
});
