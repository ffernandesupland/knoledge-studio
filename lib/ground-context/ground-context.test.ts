import { beforeEach, expect, it, vi } from "vitest";
import { resolveGroundContext, assertGroundReferencesCurrent, assertReferenceOnlyPlan, referenceFromSolution } from "./server";
import { validateGroundingEvidence, enrichWithReferences, reviewGrounding } from "./operations";
import { groundContextSchema, groundIdentity, type GroundContextSnapshot } from "./types";
import { runSchema } from "../api/validation";
import { inspectPrompt } from "../llm/client";
import { planContent } from "../llm/planning";

const mocks = vi.hoisted(() => ({ getSolution: vi.fn() }));
vi.mock("../ra/client", () => ({ ra: { getSolution: mocks.getSolution } }));
const id = "260916000000001";
const solution = { id, title: "Reference policy", status: "Published", lastModifiedDate: "2026-09-16", fields: [{ name: "Policy", content: "<p>Employees must use a managed device.</p>" }] };
const selection = { enabled: true, referenceSolutionIds: [id], guidance: "Apply to employees." };
const snapshot = (): GroundContextSnapshot => ({ selection, references: [referenceFromSolution(solution)], capturedAt: "2026-09-16" });
const article = { title: "Remote access", summary: "", keywords: [], fields: [{ fieldName: "Solution", fieldValue: "<p>Employees must use a managed device.</p>" }] };
const report = { evidence: [{ referenceId: id, fieldName: "Solution", claim: "Employees must use a managed device.", quote: "Employees must use a managed device." }], issues: [] };
beforeEach(() => { vi.resetAllMocks(); mocks.getSolution.mockResolvedValue(solution); });

it("validates unique bounded reference IDs and requires content alongside references", () => {
  expect(groundContextSchema.safeParse({ ...selection, referenceSolutionIds: [id, id] }).success).toBe(false);
  expect(groundContextSchema.safeParse({ ...selection, referenceSolutionIds: [] }).success).toBe(false);
  expect(runSchema.safeParse({ text: "", operations: [], groundContext: selection }).success).toBe(false);
  expect(runSchema.safeParse({ text: "Create remote-access guidance", operations: [], groundContext: selection }).success).toBe(true);
  expect(runSchema.safeParse({ text: "Improve", sourceSolutionIds: [id], operations: [], groundContext: selection }).success).toBe(false);
});

it("retrieves published evidence as the actor and snapshots its content", async () => {
  const resolved = await resolveGroundContext(selection, [], "author");
  expect(mocks.getSolution).toHaveBeenCalledWith(id, { impUser: "author" });
  expect(resolved?.references[0].body).toContain("Employees must use a managed device.");
  expect(resolved?.references[0].version).toHaveLength(64);
});

it("does not retrieve disabled references and rejects overlap before reading", async () => {
  expect((await resolveGroundContext({ ...selection, enabled: false }))?.references).toEqual([]);
  await expect(resolveGroundContext(selection, [id])).rejects.toThrow("both");
  expect(mocks.getSolution).not.toHaveBeenCalled();
});

it("fails on unavailable, unpublished, mismatched, and oversized reference content", async () => {
  mocks.getSolution.mockRejectedValueOnce(new Error("Access denied"));
  await expect(resolveGroundContext(selection)).rejects.toThrow("Access denied");
  mocks.getSolution.mockResolvedValueOnce({ ...solution, status: "Archived" });
  await expect(resolveGroundContext(selection)).rejects.toThrow("published");
  mocks.getSolution.mockResolvedValueOnce({ ...solution, id: "260916000000002" });
  await expect(resolveGroundContext(selection)).rejects.toThrow("different solution");
  mocks.getSolution.mockResolvedValueOnce({ ...solution, fields: [{ name: "Policy", content: "x".repeat(120_001) }] });
  await expect(resolveGroundContext(selection)).rejects.toThrow("120,000");
});

it("rechecks permissions, status and version before preparation or writes", async () => {
  await assertGroundReferencesCurrent(snapshot(), "author");
  mocks.getSolution.mockResolvedValueOnce({ ...solution, fields: [{ name: "Policy", content: "Changed policy" }] });
  await expect(assertGroundReferencesCurrent(snapshot(), "author")).rejects.toThrow("changed");
  mocks.getSolution.mockRejectedValueOnce(new Error("Access revoked"));
  await expect(assertGroundReferencesCurrent(snapshot(), "author")).rejects.toThrow("Access revoked");
});

it("blocks reference updates, merge membership and tracking comments", () => {
  const create = { kind: "create" as const, candidateKey: "c0", title: "New", templateName: "How to", fields: [], idempotencyKey: "create" };
  expect(() => assertReferenceOnlyPlan([create], snapshot())).not.toThrow();
  expect(() => assertReferenceOnlyPlan([{ ...create, mergeSources: [{ id, title: "Reference" }] }], snapshot())).toThrow("cannot be written");
  expect(() => assertReferenceOnlyPlan([{ ...create, kind: "revise", fromMerge: false, solutionId: id }], snapshot())).toThrow("cannot be written");
  expect(() => assertReferenceOnlyPlan([{ kind: "flag", solutionId: id, survivorKey: "c0", survivorLabel: "New", idempotencyKey: "flag" }], snapshot())).toThrow("cannot be written");
});

it("validates exact evidence against selected references and output claims", () => {
  expect(() => validateGroundingEvidence(report, article, snapshot())).not.toThrow();
  for (const patch of [{ referenceId: "unknown" }, { quote: "This was never in the reference." }, { claim: "Invented requirement" }, { fieldName: "Missing field" }, { quote: "<br><br><br><br>" }]) {
    expect(() => validateGroundingEvidence({ ...report, evidence: [{ ...report.evidence[0], ...patch }] }, article, snapshot())).toThrow();
  }
});

it("identifies changed reference versions and guidance without affecting old runs", () => {
  expect(groundIdentity()).toBeUndefined();
  expect(groundIdentity({ ...snapshot(), selection: { ...selection, enabled: false } })).toBeUndefined();
  expect(groundIdentity(snapshot())).not.toBe(groundIdentity({ ...snapshot(), selection: { ...selection, guidance: "Different scope" } }));
  expect(groundIdentity(snapshot())).not.toBe(groundIdentity({ ...snapshot(), references: [{ ...snapshot().references[0], version: "changed" }] }));
});

it("supplies reference-only evidence to planning and dedicated authoring/review prompts", async () => {
  const planning = await inspectPrompt(() => planContent([], [], [], [], snapshot()));
  expect(planning.blocks?.some(block => block.label.startsWith("REFERENCE ONLY:"))).toBe(true);
  expect(planning.task).toContain("never introduce additional proposals");
  const authoring = await inspectPrompt(() => enrichWithReferences(article, snapshot()));
  expect(authoring.operation).toBe("groundEnrich");
  expect(authoring.task).toContain("never processing targets");
  const review = await inspectPrompt(() => reviewGrounding(article, snapshot()));
  expect(review.task).toContain("Do not rewrite");
});

it("ignores timestamps and field serialization order while detecting material reference changes", async () => {
  const original = { ...solution, fields: [...solution.fields, { name: "Scope", content: "Employees only." }] };
  const saved = { ...snapshot(), references: [referenceFromSolution(original)] };
  mocks.getSolution.mockResolvedValue({ ...original, lastModifiedDate: "2026-09-17T12:00:00.000Z", fields: [...original.fields].reverse() });
  await expect(assertGroundReferencesCurrent(saved, "author")).resolves.toBeUndefined();
  mocks.getSolution.mockResolvedValue({ ...original, fields: [{ name: "Policy", content: "A materially different requirement." }] });
  await expect(assertGroundReferencesCurrent(saved, "author")).rejects.toMatchObject({ changes: [expect.objectContaining({ id, title: solution.title, reason: "Reference content changed (field: Policy, field: Scope)", savedBody: expect.any(String), currentBody: expect.any(String) })] });
});

it("compares legacy saved evidence without forcing a hash migration or replacing content", async () => {
  const current = referenceFromSolution(solution);
  const legacy = { ...snapshot(), references: [{ id, title: current.title, status: current.status, body: current.body, version: "old-hash-included-timestamp" }] };
  mocks.getSolution.mockResolvedValue({ ...solution, lastModifiedDate: "a newer metadata timestamp" });
  await expect(assertGroundReferencesCurrent(legacy, "author")).resolves.toBeUndefined();
  expect(legacy.references[0].version).toBe("old-hash-included-timestamp");
});
