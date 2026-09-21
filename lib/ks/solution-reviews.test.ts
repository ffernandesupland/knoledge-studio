import { beforeEach, expect, it, vi } from "vitest";
import type { WSSolution } from "../ra/types";
import { solutionVersion } from "../pipeline/version";

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), resolveConnection: vi.fn(), getSolution: vi.fn(), runOperation: vi.fn() }));
vi.mock("../db", () => ({ db: () => ({ prepare: mocks.prepare, transaction: (fn: () => Promise<unknown>) => fn }) }));
vi.mock("../ra/connections", () => ({ resolveConnection: mocks.resolveConnection }));
vi.mock("../ra/client", () => ({ ra: { getSolution: mocks.getSolution } }));
vi.mock("../llm/client", () => ({ runOperation: mocks.runOperation }));

import { assertReviewHandoffResolved, createSolutionReviewHandoff, generateSolutionReviewHandoffClarifications, resolveSolutionReviewHandoff, runSolutionReview } from "./solution-reviews";

const solution: WSSolution = {
  id: "170712210507003", title: "Connect to the corporate VPN", status: "Draft", summary: "Connect securely.",
  fields: [{ name: "Resolution", content: "Open the VPN client and approve MFA." }],
};
const definition = { id: "11111111-1111-4111-8111-111111111111", author: "author", connection_id: "connection", name: "Quality", objective: "Identify unclear or unsupported instructions.", created_at: "2026-09-20", updated_at: "2026-09-20" };
let storedReview: unknown;
let storedHandoff: Record<string, unknown> | undefined;
let storedResolutions: { question_key: string; choice: string; final_information: string; answered_at: string }[];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.resolveConnection.mockResolvedValue({ id: "connection" });
  mocks.getSolution.mockResolvedValue(solution);
  storedReview = undefined;
  storedHandoff = undefined;
  storedResolutions = [];
  mocks.prepare.mockImplementation((sql: string) => ({
    get: vi.fn().mockResolvedValue(sql.startsWith("SELECT * FROM solution_review_definitions") ? definition : sql.startsWith("SELECT * FROM solution_reviews") ? storedReview : sql.startsWith("SELECT * FROM solution_review_handoffs") ? storedHandoff : undefined),
    all: vi.fn().mockImplementation(async () => sql.startsWith("SELECT question_key") ? storedResolutions : []),
    run: vi.fn().mockImplementation(async (...args: unknown[]) => {
      if (sql.startsWith("INSERT INTO solution_review_handoff_resolutions")) {
        const [, question_key, choice, final_information, answered_at] = args as string[];
        storedResolutions = [{ question_key, choice, final_information, answered_at }];
      }
      if (sql.startsWith("UPDATE solution_review_handoffs SET review_objectives")) {
        storedHandoff = { ...storedHandoff, review_objectives: args[0] as string };
      }
      return { changes: 1 };
    }),
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
  expect(handoff.reviewObjectives[0]).toMatchObject({ disposition: "native", nativeOperation: "Find duplicates", instruction: "Compare the overlapping solution before merging." });
});

it("retains the customer criterion for a field-level content-standard review", async () => {
  storedReview = {
    id: "33333333-3333-4333-8333-333333333333", author: "author", connection_id: "connection", solution_id: solution.id,
    source_version: solutionVersion(solution), definition_id: definition.id, status: "completed",
    result: JSON.stringify({ summary: "Style concern.", findings: [{ title: "Formatting", category: "Style", severity: "medium", summary: "Formatting differs.", recommendation: "Apply the customer style requirement.", evidence: [{ fieldName: "Resolution", quote: "approve MFA" }], confidence: 0.8 }], limitations: [] }),
    error: null, created_at: "2026-09-20", completed_at: "2026-09-20",
  };
  const handoff = await createSolutionReviewHandoff("author", (storedReview as { id: string }).id, [0]);
  expect(handoff.reviewObjectives[0]).toMatchObject({ nativeOperation: "Apply content standards", criteria: definition.objective });
});

it("blocks a handoff for a legacy contradiction until the author supplies final information", async () => {
  storedReview = {
    id: "44444444-4444-4444-8444-444444444444", author: "author", connection_id: "connection", solution_id: solution.id,
    source_version: solutionVersion(solution), definition_id: definition.id, status: "completed",
    result: JSON.stringify({ summary: "Conflicting instructions.", findings: [{ title: "Mutually exclusive connection states", category: "Contradiction", severity: "high", summary: "The saved solution gives two incompatible states.", recommendation: "Confirm the final supported state.", evidence: [{ fieldName: "Resolution", quote: "approve MFA" }], confidence: 0.9 }], limitations: [] }),
    error: null, created_at: "2026-09-20", completed_at: "2026-09-20",
  };
  const handoff = await createSolutionReviewHandoff("author", (storedReview as { id: string }).id, [0]);
  expect(handoff.reviewObjectives[0].clarification?.choices).toContain("Replace the conflicting statements with my final wording");
  expect(() => assertReviewHandoffResolved(handoff)).toThrow("Answer 1 required contradiction question");
});

it("marks a legacy contradiction for an explicit AI-generated decision upgrade", async () => {
  storedReview = {
    id: "66666666-6666-4666-8666-666666666666", author: "author", connection_id: "connection", solution_id: solution.id,
    source_version: solutionVersion(solution), definition_id: definition.id, status: "completed",
    result: JSON.stringify({ summary: "Conflicting NA handling.", findings: [{ title: "Conflicting NA skip status", category: "Contradiction", severity: "high", summary: "The solution gives incompatible NA handling.", recommendation: "Confirm the final rule.", evidence: [{ fieldName: "Error Message", quote: "Solr DB Reindex this should be skipped and NA it should not" }, { fieldName: "Cause", quote: "This is skipped for NA only" }], confidence: 0.9 }], limitations: [] }),
    error: null, created_at: "2026-09-20", completed_at: "2026-09-20",
  };
  const handoff = await createSolutionReviewHandoff("author", (storedReview as { id: string }).id, [0]);
  expect(handoff.reviewObjectives[0].clarification?.source).toBe("fallback");
});

it("uses AI to generate evidence-specific choices for an older handoff", async () => {
  storedHandoff = {
    id: "77777777-7777-4777-8777-777777777777", author: "author", connection_id: "connection", solution_id: solution.id,
    source_version: solutionVersion(solution), review_id: "44444444-4444-4444-8444-444444444444", selected_finding_indexes: "[0]", native_operations: "[]",
    review_objectives: JSON.stringify([{ key: "44444444-4444-4444-8444-444444444444:0", label: "Conflicting NA skip status", instruction: "Confirm the intended NA handling.", findingIndexes: [0], evidence: [{ fieldName: "Error Message", quote: "Solr DB Reindex should be skipped and NA should not" }, { fieldName: "Cause", quote: "This is skipped for NA only" }], disposition: "custom" }]),
    created_at: "2026-09-20", consumed_at: null,
  };
  mocks.runOperation.mockResolvedValue({ data: { clarifications: [{ key: "44444444-4444-4444-8444-444444444444:0", question: "Should the article say that NA is skipped?", choices: ["Yes — NA is skipped", "No — NA is not skipped", "Separate scenario"] }] } });
  const handoff = await generateSolutionReviewHandoffClarifications("author", storedHandoff.id as string);
  expect(handoff.reviewObjectives[0].clarification?.question).toBe("Should the article say that NA is skipped?");
  expect(handoff.reviewObjectives[0].clarification?.choices).toEqual(expect.arrayContaining(["Yes — NA is skipped", "No — NA is not skipped"]));
  expect(handoff.reviewObjectives[0].clarification?.source).toBe("model");
});

it("upgrades a legacy handoff with a contradiction gate and returns the saved author decision", async () => {
  storedHandoff = {
    id: "55555555-5555-4555-8555-555555555555", author: "author", connection_id: "connection", solution_id: solution.id,
    source_version: solutionVersion(solution), review_id: "44444444-4444-4444-8444-444444444444", selected_finding_indexes: "[0]", native_operations: "[]",
    review_objectives: JSON.stringify([{ key: "44444444-4444-4444-8444-444444444444:0", label: "Conflicting state", instruction: "Confirm the supported state.", findingIndexes: [0], evidence: [{ fieldName: "Resolution", quote: "approve MFA" }], disposition: "custom" }]),
    created_at: "2026-09-20", consumed_at: null,
  };
  const handoff = await resolveSolutionReviewHandoff("author", storedHandoff.id as string, [{ questionKey: "44444444-4444-4444-8444-444444444444:0", choice: "Replace the conflicting statements with my final wording", finalInformation: "The NA step is not skipped." }]);
  expect(handoff.reviewObjectives[0].resolution).toMatchObject({ choice: "Replace the conflicting statements with my final wording", finalInformation: "The NA step is not skipped." });
  expect(() => assertReviewHandoffResolved(handoff)).not.toThrow();
});
