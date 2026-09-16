import * as duplicateEngine from "./dedupe";
import { referenceFromSolution } from "../ground-context/server";
import { sourceContext } from "../llm/source-context";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase, db, useDatabase } from "../db";
import { createRun, completeRun, getRun, saveSnapshot, type DecisionSnapshot } from "../db/runs";
import { runPipeline } from "./run";
import { executeWritePlan, type ExecuteArgs } from "./execute";
import { buildWritePlan, type WriteOp } from "./submit";
import { mapRunToView } from "../ks/model";
import { freezeExecution, getWriteState, saveWriteState, withRunLock } from "./state";
import { canonicalSnapshot } from "../api/validation";
import { KS_OPS_DEFAULT } from "../ks/data";
import { POST as submitRoute } from "../../app/api/submit/route";
import { submissionIdentity } from "../ks/submission-plan";
import { readExecutedFlow } from "../flow/executions";
import { loadExecution, savePreparationPlan, freezePreparedPlan } from "./state";
import { POST as reconcile } from "../../app/api/submit/reconcile/route";
import { RaError } from "../ra/http";

const mocks = vi.hoisted(() => ({
  templates: vi.fn(), solution: vi.fn(), search: vi.fn(), history: vi.fn(), write: vi.fn(), update: vi.fn(), flag: vi.fn(),
  ground: vi.fn(), groundReview: vi.fn(), plan: vi.fn(), split: vi.fn(), choose: vi.fn(), restructure: vi.fn(), standards: vi.fn(), optimize: vi.fn(), gaps: vi.fn(), merge: vi.fn(),
}));
vi.mock("../ra/client", () => ({ withRaActor: (_user: string, fn: () => unknown) => fn(), ra: { getCollections: async () => [{ code: "custom_kb", displayName: "Custom" }], getTemplates: mocks.templates, getSolution: mocks.solution, getSolutionHtml: mocks.solution, search: mocks.search, getCompanyTopSearches: mocks.history, manageSolution: mocks.write, updateSolution: mocks.update, flagMergedInto: mocks.flag } }));
vi.mock("../llm/planning", () => ({ planContent: mocks.plan }));
vi.mock("../llm/operations", () => ({ splitTopics: mocks.split, chooseTemplate: mocks.choose, restructure: mocks.restructure, applyStandards: mocks.standards, optimizeForSearch: mocks.optimize, findGaps: mocks.gaps, mergeSections: mocks.merge }));

vi.mock("../ground-context/operations", () => ({ enrichWithReferences: mocks.ground, reviewGrounding: mocks.groundReview }));
const template = { templateName: "How To (RA)", templateType: "standard", kbPrefix: "", fields: ["Solution", "Details"].map((fieldName) => ({ fieldName, required: false, description: "", searchable: true })) };
const fields = [{ fieldName: "Solution", fieldValue: "<p>Original answer</p>" }, { fieldName: "Details", fieldValue: "" }];
const source = { id: "260909000000002", title: "Existing article", templateName: template.templateName, status: "Published", fields: fields.map((f) => ({ name: f.fieldName, content: f.fieldValue })) };
const result = <T>(data: T) => ({ data, model: "test", costUsd: 0.01, inputTokens: 10, outputTokens: 20 });
let dir: string;
let counter = 0;
let runId: string;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "ks-engine-")); useDatabase(path.join(dir, "test.db")); });
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.resetAllMocks();
  runId = `engine-${++counter}`;
  (await createRun({ id: runId, author: "sauser", path: "create", inputText: "source", sourceIds: [], operations: [] }));
  mocks.plan.mockImplementation(async (evidence) => result({ proposals: evidence.map((e: { key: string }) => ({ key: e.key, purpose: "Help the reader", coverage: ["Supported scope"], rationale: "A distinct supported user need", openQuestions: [] })) }));
  mocks.templates.mockResolvedValue([template]); mocks.solution.mockImplementation(async (id) => ({ ...source, id }));
  mocks.history.mockResolvedValue([]); mocks.search.mockResolvedValue({ solutions: [], totalHits: 0 });
  mocks.write.mockResolvedValue("Successfully created solution with ID: 260909000000003");
  mocks.update.mockResolvedValue({ solutionId: "260909000000004", mode: "revision", request: { revisionParentID: source.id } });
  mocks.flag.mockResolvedValue("ok");
  mocks.restructure.mockResolvedValue(result({ title: "Generated title", summary: "Generated summary", keywords: ["vpn"], fields: [{ fieldName: "Solution", fieldValue: "<ol><li>Authored answer</li></ol>" }, fields[1]] }));
  mocks.standards.mockImplementation(async (f) => result({ fields: f, ruleResults: [{ rule: "Numbered steps", passedBefore: true, changed: false, note: "Already numbered" }] }));
  mocks.merge.mockResolvedValue(result({ sections: fields.map((f) => ({ fieldName: f.fieldName, combined: f.fieldValue, contributions: [], noMatchNote: "", conflict: { present: false, optionA: { from: "", text: "" }, optionB: { from: "", text: "" }, mergedDefault: "" } })) }));
});
const newOp = (key = "c0"): Extract<WriteOp, { kind: "create" }> => ({ kind: "create", candidateKey: key, title: "Raw title", templateName: template.templateName, fields, rawContent: "Original answer", idempotencyKey: `${runId}:create:${key}` });
const args = (plan: WriteOp[], extra: Partial<ExecuteArgs> = {}): ExecuteArgs => ({ runId, user: "sauser", plan, collection: "custom_kb", language: "English", ...extra });

describe("analysis → view → plan contract", () => {
  it("reports template loading before waiting for RightAnswers", async () => {
    const progress = vi.fn();
    mocks.templates.mockImplementation(async () => {
      expect(progress).toHaveBeenCalledWith({ step: "Loading article templates", status: "start" });
      return [template];
    });
    await runPipeline({ text: "Source facts", operations: [] }, progress);
    expect(progress).toHaveBeenCalledWith({ step: "Loading article templates", status: "done" });
  });
  it("blocks HTML summaries before writing and allows a plain-text correction", async () => {
    mocks.restructure.mockResolvedValue(result({ title: "Article", summary: "<p>Summary</p>", keywords: [], fields }));
    const plan = [newOp()];
    const first = await executeWritePlan(args(plan, { prepareOnly: true }));
    expect(first[0]).toMatchObject({ outcome: "review", message: expect.stringContaining("Summary must be plain text") });
    expect(mocks.write).not.toHaveBeenCalled();
    const prepared = first[0].prepared!;
    const corrected = await executeWritePlan(args(plan, { prepareOnly: true, reviews: { [plan[0].idempotencyKey]: { version: prepared.version, summary: "Summary", fields } } }));
    expect(corrected[0]).toMatchObject({ outcome: "ready", prepared: { summary: "Summary" } });
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("builds a plan from evidence without authoring, even with optional operations off", async () => {
    const view = mapRunToView(await runPipeline({ text: "Source facts", attachments: [{ label: "Manual.txt", text: "Additional facts" }], operations: [] }));
    expect(mocks.plan.mock.calls[0][0][0]).toMatchObject({ content: "Source facts\n\nAdditional facts", proposedAction: "create", sourceLabels: ["pasted text", "Manual.txt"], duplicateEvidence: { checked: false } });
    expect(view.candidates[0].why).toBe("A distinct supported user need");
    expect(view.candidates[0].proposal?.coverage).toEqual(["Supported scope"]);
    expect(mocks.restructure).not.toHaveBeenCalled();
    expect(mocks.write).not.toHaveBeenCalled();
    const plan = buildWritePlan({ runId, ...view, selected: new Set(["c0"]), resolutions: [] });
    await executeWritePlan(args(plan, { restructureEnabled: true }));
    expect(mocks.restructure.mock.calls[0][2]).toEqual(view.candidates[0].proposal);
  });
  it("includes typed text, multiple images and a PDF together in planning evidence", async () => {
    await runPipeline({ text: "User context", attachments: [
      { label: "screen-one.png", text: "First screenshot evidence" },
      { label: "screen-two.jpg", text: "Second screenshot evidence" },
      { label: "manual.pdf", text: "PDF instructions" },
    ], operations: [] });
    expect(mocks.plan.mock.calls[0][0][0]).toMatchObject({
      content: "User context\n\nFirst screenshot evidence\n\nSecond screenshot evidence\n\nPDF instructions",
      sourceLabels: ["pasted text", "screen-one.png", "screen-two.jpg", "manual.pdf"],
    });
  });
  it("preserves ordered originals in analysis and restores them for article preparation", async () => {
    const content = [{ id: "before", type: "text" as const, text: "Before image" }, { id: "image", type: "attachment" as const, attachmentId: "a" }, { id: "after", type: "text" as const, text: "After image" }];
    const attachments = [{ id: "a", label: "image.png", text: "Original image", imageId: "image-asset" }];
    await db().prepare("UPDATE run_sources SET payload=? WHERE run_id=?").run(JSON.stringify(attachments), runId);
    await db().prepare("INSERT INTO run_source_documents(run_id,payload) VALUES (?,?)").run(runId, JSON.stringify(content));
    let analysisContext: unknown;
    const planner = mocks.plan.getMockImplementation()!;
    mocks.plan.mockImplementationOnce((...args) => { analysisContext = sourceContext(); return planner(...args); });
    await runPipeline({ text: "Before image\nAfter image", attachments, content, operations: [] });
    expect(analysisContext).toEqual([{ label: "Text 1", content: "Before image" }, { label: "image.png", content: "Original image", imageId: "image-asset" }, { label: "Text 3", content: "After image" }]);
    let preparationContext: unknown;
    mocks.restructure.mockImplementationOnce(() => { preparationContext = sourceContext(); return result({ title: "Article", summary: "Summary", keywords: [], fields }); });
    await executeWritePlan(args([newOp()], { prepareOnly: true }));
    expect(preparationContext).toEqual(analysisContext);
  });
  it("rejects invented topic keys from the planner", async () => {
    mocks.plan.mockResolvedValue(result({ proposals: [{ key: "made-up", purpose: "x", coverage: ["x"], rationale: "x", openQuestions: [] }] }));
    await expect(runPipeline({ text: "Source", operations: [] })).rejects.toThrow("does not match");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("preserves an existing update target all the way to the write plan", async () => {
    const view = mapRunToView(await runPipeline({ text: "", sourceSolutionIds: [source.id], operations: [] }));
    const plan = buildWritePlan({ runId, ...view, selected: new Set([source.id]), resolutions: [] });
    expect(view.candidates[0]).toMatchObject({ key: source.id, targetSolutionId: source.id, templateName: source.templateName, action: "Update" });
    expect(plan[0]).toMatchObject({ kind: "revise", fromMerge: false, solutionId: source.id });
    expect(mocks.choose).not.toHaveBeenCalled();
  });
  it("retains original HTML if restructuring is disabled after analysis", async () => {
    const markdown = { ...source, fields: [{ name: "Solution", content: "1. Restart\n2. Reconnect" }, { name: "Details", content: "" }] };
    const html = { ...source, fields: [{ name: "Solution", content: "<ol><li>Restart</li><li>Reconnect</li></ol>" }, { name: "Details", content: "" }] };
    mocks.solution.mockResolvedValueOnce(markdown).mockResolvedValueOnce(html).mockResolvedValue(markdown);
    const view = mapRunToView(await runPipeline({ text: "", sourceSolutionIds: [source.id], operations: ["Restructure content"] }));
    const plan = buildWritePlan({ runId, ...view, selected: new Set([source.id]), resolutions: [] });
    const [written] = await executeWritePlan(args(plan, { restructureEnabled: false }));
    expect(written.outcome).toBe("ok");
    expect(mocks.update.mock.calls[0][1].fields[0].fieldValue).toBe(html.fields[0].content);
    expect(mocks.restructure).not.toHaveBeenCalled();
  });
  it("keeps fresh material separate from picked sources", async () => {
    const output = await runPipeline({ text: "A new topic", sourceSolutionIds: [source.id], operations: [] });
    expect(output.solutions.map((s) => s.targetSolutionId)).toEqual([undefined, source.id]);
  });
  it("splits a source into new drafts without guessing a replacement", async () => {
    mocks.split.mockResolvedValue(result({ topics: [{ title: "B", content: "Second topic", rationale: "Separate" }, { title: "A", content: "First topic", rationale: "Separate" }] }));
    const output = await runPipeline({ text: "", sourceSolutionIds: [source.id], operations: ["Split topics"] });
    expect(output.solutions).toHaveLength(2);
    expect(output.solutions.every((s) => !s.targetSolutionId && s.sourceIds?.[0] === source.id)).toBe(true);
  });
  it("does not trigger template AI when all operations are off", async () => {
    mocks.templates.mockResolvedValue([template, { ...template, templateName: "Other" }]);
    await runPipeline({ text: "A useful answer", operations: [] });
    expect(mocks.choose).not.toHaveBeenCalled();
    expect(mocks.restructure).not.toHaveBeenCalled();
  });
  it("retains optimized keywords through view mapping and planning", async () => {
    mocks.history.mockResolvedValue([{ description: "vpn setup" }]);
    mocks.optimize.mockResolvedValue(result({ changed: true, title: "Search title", keywords: ["vpn setup"] }));
    const view = mapRunToView(await runPipeline({ text: "Answer", operations: ["Optimize for search"] }));
    expect(buildWritePlan({ runId, ...view, selected: new Set(["c0"]), resolutions: [] })[0]).toMatchObject({ title: "Search title", keywords: ["vpn setup"], titleLocked: true });
  });
  it("does not turn a failed search into gap evidence", async () => {
    mocks.history.mockResolvedValue([{ description: "VPN" }]); mocks.search.mockRejectedValue(new Error("offline"));
    const output = await runPipeline({ text: "", operations: ["Find gaps"] });
    expect(mocks.gaps).not.toHaveBeenCalled(); expect(output.warnings?.[0]).toContain("omitted");
  });
  it("reads full articles for gaps and prevents research suggestions from being written", async () => {
    mocks.history.mockResolvedValue([{ description: "VPN" }]); mocks.search.mockResolvedValue({ solutions: [source] });
    mocks.gaps.mockResolvedValue(result({ gaps: [{ question: "VPN", suggestedTitle: "Missing VPN", confidence: 0.8, rationale: "Missing answer" }] }));
    const view = mapRunToView(await runPipeline({ text: "", operations: ["Find gaps"] }));
    expect(mocks.gaps.mock.calls[0][0][0].articles[0]).toContain("Original answer");
    expect(view.candidates[0].researchOnly).toBe(true);
    expect(() => buildWritePlan({ runId, ...view, selected: new Set(["g0"]), resolutions: [] })).toThrow("Research");
  });
});

describe("submission contracts", () => {
  it("passes reviewed scope and original source text into merges even before template fields are authored", async () => {
    const proposal = { purpose: "Consolidate supported coverage", coverage: ["Shared problem", "Unique details"], rationale: "Same need", openQuestions: [] };
    const op = { ...newOp(), fields: [], proposal, mergeSources: [{ id: "c1", title: "Other topic", fields: [], rawContent: "Unique verified source", proposal }] };
    const [written] = await executeWritePlan(args([op]));
    expect(written.outcome).toBe("ok");
    expect(mocks.merge.mock.calls[0][0].map((b: { body: string }) => b.body)).toEqual(["Original answer", "Unique verified source"]);
    expect(mocks.merge.mock.calls[0][2]).toEqual([proposal, proposal]);
  });
  it("maps new articles into the final template with rewriting disabled", async () => {
    const op = { ...newOp(), fields: fields.map((f) => ({ ...f, fieldValue: "" })) };
    const [written] = await executeWritePlan(args([op], { restructureEnabled: false }));
    expect(written.outcome).toBe("ok");
    expect(mocks.restructure.mock.calls[0][3]).toBe(true);
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ summary: "Generated summary", keywords: "vpn", templateName: template.templateName });
    expect(mocks.write.mock.calls[0][0].fields[0].fieldValue).toContain("<ol>");
  });
  it("regenerates only the blocked item from saved sources and pauses without writes", async () => {
    const op = newOp();
    const prepared = { version: "old-version", title: op.title, summary: "", keywords: [], templateName: "AI Template", fields: [], warnings: [] };
    (await saveWriteState(runId, op.idempotencyKey, { status: "review", prepared }));
    const reviews = { [op.idempotencyKey]: { version: prepared.version, fields: [], regenerate: true, templateName: template.templateName } };
    const [regenerated] = await executeWritePlan(args([op, newOp("other")], { reviews }));
    expect(regenerated.outcome).toBe("review");
    expect(regenerated.prepared?.version).not.toBe(prepared.version);
    expect(regenerated.prepared?.templateName).toBe(template.templateName);
    expect(mocks.restructure.mock.calls[0][0][0].content).toBe("Original answer");
    expect(mocks.write).not.toHaveBeenCalled();
    const [submitted] = await executeWritePlan(args([op], { reviews: { [op.idempotencyKey]: { version: regenerated.prepared!.version, fields: regenerated.prepared!.fields } } }));
    expect(submitted.outcome).toBe("ok");
    expect(mocks.restructure).toHaveBeenCalledTimes(1);
  });
  it("writes generated metadata and audits the actual authored fields", async () => {
    const [r] = await executeWritePlan(args([newOp()], { restructureEnabled: true }));
    expect(r.outcome).toBe("ok");
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ title: "Generated title", summary: "Generated summary", keywords: "vpn", status: "review" });
    const row = (await db().prepare("SELECT request FROM write_audit WHERE idempotency_key=?").get(r.idempotencyKey)) as { request: string };
    expect(JSON.parse(row.request).fields[0].fieldValue).toContain("Authored answer");
  });
  it("preserves an explicitly optimized or edited title", async () => {
    const [r] = await executeWritePlan(args([{ ...newOp(), title: "User title", titleLocked: true }], { restructureEnabled: true }));
    expect(r.title).toBe("User title");
  });
  it("pauses on conflicts, persists preparation, then applies standards after human resolution", async () => {
    mocks.merge.mockResolvedValue(result({ sections: fields.map((f, i) => ({ fieldName: f.fieldName, combined: i ? "" : "", contributions: [], noMatchNote: "", conflict: { present: i === 0, optionA: { from: "A", text: "Cause A" }, optionB: { from: "B", text: "Cause B" }, mergedDefault: "" } })) }));
    const op = { ...newOp(), mergeSources: [{ id: "c1", title: "Other draft", fields, templateName: template.templateName }] };
    const execution = args([op], { standardsRules: ["Numbered steps"] });
    const [first] = await executeWritePlan(execution);
    expect(first.outcome).toBe("review"); expect(mocks.write).not.toHaveBeenCalled();
    expect((await getWriteState(op.idempotencyKey))?.status).toBe("review");
    const [second] = await executeWritePlan({ ...execution, reviews: { [op.idempotencyKey]: { version: first.prepared!.version, fields } } });
    expect(second.outcome).toBe("ok"); expect(mocks.merge).toHaveBeenCalledTimes(1); expect(mocks.standards).toHaveBeenCalledTimes(1);
  });
  it("rejects stale conflict resolutions", async () => {
    const op = newOp();
    const [r] = await executeWritePlan(args([op], { reviews: { [op.idempotencyKey]: { version: "wrong", fields } } }));
    expect(r.outcome).toBe("error"); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("flags existing losers with the actual new survivor ID", async () => {
    const op = { ...newOp(), mergeSources: [{ id: source.id, title: source.title }] };
    const flag: WriteOp = { kind: "flag", solutionId: source.id, survivorKey: "c0", survivorLabel: "New survivor (c0)", idempotencyKey: `${runId}:flag:${source.id}` };
    const output = await executeWritePlan(args([op, flag]));
    expect(output.every((r) => r.outcome === "ok")).toBe(true);
    expect(mocks.flag).toHaveBeenCalledWith(source.id, { id: "260909000000003", title: "Raw title" }, { impUser: "sauser" });
  });
  it("does not let an unrelated failure block a successful group's flag", async () => {
    mocks.write.mockRejectedValueOnce(new RaError("Denied", 403, "manageSolution", ""));
    const good = { ...newOp("c1"), mergeSources: [{ id: source.id, title: source.title }] };
    const flag: WriteOp = { kind: "flag", solutionId: source.id, survivorKey: "c1", survivorLabel: "Survivor", idempotencyKey: `${runId}:flag:x` };
    const output = await executeWritePlan(args([newOp(), good, flag]));
    expect(output.map((r) => r.outcome)).toEqual(["error", "ok", "ok"]);
  });
  it("replays saved successes without making another write", async () => {
    const execution = args([newOp()]);
    const first = await executeWritePlan(execution), second = await executeWritePlan(execution);
    expect(second).toEqual(first); expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("blocks automatic retry after an uncertain response", async () => {
    mocks.write.mockRejectedValue(new Error("socket closed after sending"));
    const execution = args([newOp()]);
    expect((await executeWritePlan(execution))[0].outcome).toBe("uncertain");
    expect((await executeWritePlan(execution))[0].outcome).toBe("uncertain");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("serializes submissions across callers", async () => {
    let finish!: () => void;
    const first = withRunLock(runId, () => new Promise<void>((resolve) => { finish = resolve; }));
    await expect(withRunLock(runId, async () => undefined)).rejects.toThrow("already being processed");
    finish(); await first;
    await expect(withRunLock(runId, async () => "released")).resolves.toBe("released");
  });
  it("pauses for missing required content rather than inventing it", async () => {
    mocks.templates.mockResolvedValue([{ ...template, fields: template.fields.map((f) => ({ ...f, required: true })) }]);
    const [r] = await executeWritePlan(args([newOp()]));
    expect(r.outcome).toBe("review"); expect(r.message).toContain("Required field"); expect(mocks.write).not.toHaveBeenCalled();
  });
  it("will not overwrite an unrelated pending revision", async () => {
    mocks.solution.mockResolvedValue({ ...source, revisionID: "child260909000000009" });
    const op: WriteOp = { kind: "revise", candidateKey: source.id, solutionId: source.id, title: source.title, templateName: template.templateName, fields, fromMerge: false, idempotencyKey: `${runId}:revise:x` };
    expect((await executeWritePlan(args([op])))[0].message).toContain("pending revision"); expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("decision ownership and persistence", () => {
  it("round-trips survivor, empty selection, standards, templates and disabled AI", async () => {
    const view = mapRunToView(await runPipeline({ text: "New answer", operations: [] }));
    view.groups = [{ survivorId: "c0", averageSimilarity: 90, reason: "Overlap", members: [{ id: "c0", title: "Draft", stat: "New", retained: true }, { id: source.id, title: source.title, stat: "Existing", retained: false }] }];
    (await completeRun(runId, view));
    const snapshot: DecisionSnapshot = { ...view, groups: [{ ...view.groups[0], survivorId: source.id }], selectedKeys: [], resolutions: ["merged"], operations: KS_OPS_DEFAULT.map((o) => ({ ...o, on: false })), collection: "Custom", language: "French", standard: "Custom", standardsRules: ["Active voice"], newSolutionTemplate: template.templateName, templateOverrides: ["c0"] };
    (await saveSnapshot(runId, canonicalSnapshot((await getRun(runId))!, snapshot)));
    expect((await getRun(runId))!.snapshot).toMatchObject({ selectedKeys: [], resolutions: ["merged"], groups: [{ survivorId: source.id }], standardsRules: ["Active voice"], language: "French", templateOverrides: ["c0"] });
    expect((await getRun(runId))!.snapshot!.operations.every((o) => !o.on)).toBe(true);
  });
  it("does not accept invented write targets from the browser", async () => {
    const view = mapRunToView(await runPipeline({ text: "New answer", operations: [] })); (await completeRun(runId, view));
    const snapshot = { ...view, candidates: [{ ...view.candidates[0], targetSolutionId: source.id, proposal: { purpose: "Forged", coverage: ["Invented"], rationale: "Forged", openQuestions: [] } }], selectedKeys: ["c0"], resolutions: [], operations: KS_OPS_DEFAULT.map((o) => ({ ...o, on: false })), collection: "Custom", language: "English", standard: "Default", standardsRules: [], newSolutionTemplate: null, templateOverrides: [] };
    expect(canonicalSnapshot((await getRun(runId))!, snapshot).candidates[0].targetSolutionId).toBeUndefined();
    expect(canonicalSnapshot((await getRun(runId))!, snapshot).candidates[0].proposal).toEqual(view.candidates[0].proposal);
  });
});


describe("uncertain-write reconciliation", () => {
  const request = (body: unknown) => new Request("http://localhost/api/submit/reconcile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  it("confirms a matching actual article and never repeats the write", async () => {
    const op = newOp(), execution = args([op]);
    (await freezeExecution(runId, execution));
    mocks.write.mockRejectedValueOnce(new Error("response lost"));
    await executeWritePlan(execution);
    const prepared = (await getWriteState(op.idempotencyKey))!.prepared!;
    mocks.solution.mockResolvedValue({ ...source, id: "260909000000003", title: prepared.title, fields: prepared.fields.map((f) => ({ name: f.fieldName, content: f.fieldValue })) });
    const response = await reconcile(request({ runId, key: op.idempotencyKey, action: "confirm", solutionId: "260909000000003", verified: true }));
    expect(response.status).toBe(200);
    expect((await executeWritePlan(execution))[0].outcome).toBe("ok");
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("refuses to confirm a different article", async () => {
    const op = newOp(), execution = args([op]); (await freezeExecution(runId, execution));
    mocks.write.mockRejectedValueOnce(new Error("response lost")); await executeWritePlan(execution);
    const response = await reconcile(request({ runId, key: op.idempotencyKey, action: "confirm", solutionId: source.id, verified: true }));
    expect(response.status).toBe(400);
    expect((await getWriteState(op.idempotencyKey))?.status).toBe("uncertain");
  });
  it("requires explicit verified absence before reopening an uncertain write", async () => {
    const op = newOp(), execution = args([op]); (await freezeExecution(runId, execution));
    mocks.write.mockRejectedValueOnce(new Error("response lost")); await executeWritePlan(execution);
    expect((await reconcile(request({ runId, key: op.idempotencyKey, action: "retry", verified: false }))).status).toBe(400);
    expect((await reconcile(request({ runId, key: op.idempotencyKey, action: "retry", verified: true }))).status).toBe(200);
    expect((await executeWritePlan(execution))[0].outcome).toBe("ok");
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });
});

describe("prepare, review, then write", () => {
  it("prepares all draft metadata and fields without any KB write or merge comment", async () => {
    const op = newOp();
    const [prepared] = await executeWritePlan(args([op], { prepareOnly: true, standardsRules: ["Numbered steps"] }));
    expect(prepared.outcome).toBe("ready");
    expect(prepared.prepared).toMatchObject({ readyForSubmission: true, title: "Generated title", summary: "Generated summary", keywords: ["vpn"], standardsApplied: true });
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.flag).not.toHaveBeenCalled();
    const [written] = await executeWritePlan(args([op], { requirePrepared: true, approvals: { [op.idempotencyKey]: prepared.prepared!.version }, standardsRules: ["Numbered steps"] }));
    expect(written.outcome).toBe("ok");
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ title: prepared.prepared!.title, summary: prepared.prepared!.summary, fields: prepared.prepared!.fields });
    expect(mocks.restructure).toHaveBeenCalledTimes(1); expect(mocks.standards).toHaveBeenCalledTimes(1);
  });
  it("preflights every article and refuses missing or stale review versions before any write", async () => {
    const a = newOp("a"), b = newOp("b");
    const [ready] = await executeWritePlan(args([a], { prepareOnly: true }));
    await expect(executeWritePlan(args([a, b], { requirePrepared: true, approvals: { [a.idempotencyKey]: ready.prepared!.version } }))).rejects.toThrow("every draft");
    await expect(executeWritePlan(args([a], { requirePrepared: true, approvals: { [a.idempotencyKey]: "old-version" } }))).rejects.toThrow("every draft");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("saves reviewed title, summary, keywords and HTML fields with a new version", async () => {
    const op = newOp();
    const [first] = await executeWritePlan(args([op], { prepareOnly: true }));
    const review = { version: first.prepared!.version, title: "Edited title", summary: "Edited summary", keywords: ["edited"], fields: [{ fieldName: "Solution", fieldValue: "<p>Reviewed answer</p>" }, fields[1]] };
    const [second] = await executeWritePlan(args([op], { prepareOnly: true, reviews: { [op.idempotencyKey]: review } }));
    expect(second.prepared!.version).not.toBe(first.prepared!.version);
    expect(second.prepared).toMatchObject({ title: review.title, summary: review.summary, keywords: review.keywords, fields: review.fields });
    expect(mocks.write).not.toHaveBeenCalled();
    await executeWritePlan(args([op], { requirePrepared: true, approvals: { [op.idempotencyKey]: second.prepared!.version } }));
    expect(mocks.write.mock.calls[0][0]).toMatchObject({ title: review.title, summary: review.summary, keywords: "edited", fields: review.fields });
    expect(mocks.restructure).toHaveBeenCalledTimes(1);
  });
  it("prepares a merge with an external survivor and defers the tracking comment until submission", async () => {
    const op: WriteOp = { kind: "revise", candidateKey: source.id, solutionId: source.id, title: source.title, fromMerge: true, mergeSources: [{ id: "260909000000006", title: "Other article" }], idempotencyKey: `${runId}:revise:${source.id}` };
    const flag: WriteOp = { kind: "flag", solutionId: "260909000000006", survivorKey: source.id, survivorLabel: source.title, idempotencyKey: `${runId}:flag:other` };
    const prepared = await executeWritePlan(args([op, flag], { prepareOnly: true }));
    expect(prepared.map((r) => r.outcome)).toEqual(["ready", "skipped"]);
    expect(prepared[0].prepared!.sourceDocuments?.map((d) => d.id)).toEqual([source.id, "260909000000006"]);
    expect(mocks.flag).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
    const written = await executeWritePlan(args([op, flag], { requirePrepared: true, approvals: { [op.idempotencyKey]: prepared[0].prepared!.version } }));
    expect(written.map((r) => r.outcome)).toEqual(["ok", "ok"]);
    expect(mocks.update).toHaveBeenCalledTimes(1); expect(mocks.flag).toHaveBeenCalledTimes(1); expect(mocks.merge).toHaveBeenCalledTimes(1);
  });
  it("requires resolving merge conflicts during preparation and never writes unresolved articles", async () => {
    mocks.merge.mockResolvedValueOnce(result({ sections: [{ fieldName: "Solution", combined: "<p>Default</p>", contributions: [], conflict: { present: true, optionA: { from: "A", text: "x" }, optionB: { from: "B", text: "y" }, mergedDefault: "x" } }, { fieldName: "Details", combined: "", contributions: [], conflict: { present: false } }] }));
    const op = { ...newOp(), mergeSources: [{ id: "c1", title: "Other", fields }] };
    const [review] = await executeWritePlan(args([op], { prepareOnly: true }));
    expect(review.outcome).toBe("review");
    await expect(executeWritePlan(args([op], { requirePrepared: true, approvals: { [op.idempotencyKey]: review.prepared!.version } }))).rejects.toThrow("every draft");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("checks source versions again before writing reviewed revisions", async () => {
    const op: WriteOp = { kind: "revise", candidateKey: source.id, solutionId: source.id, title: source.title, templateName: template.templateName, fields, fromMerge: false, idempotencyKey: `${runId}:revise:source` };
    const [prepared] = await executeWritePlan(args([op], { prepareOnly: true }));
    mocks.solution.mockResolvedValue({ ...source, title: "Changed externally" });
    const [rejected] = await executeWritePlan(args([op], { requirePrepared: true, approvals: { [op.idempotencyKey]: prepared.prepared!.version } }));
    expect(rejected.outcome).toBe("error"); expect(rejected.message).toContain("changed after preparation"); expect(mocks.update).not.toHaveBeenCalled();
  });
});

describe("review route and plan invalidation", () => {
  async function fixture() {
    const view = mapRunToView(await runPipeline({ text: "A supported answer", operations: [] }));
    await completeRun(runId, view);
    const snapshot: DecisionSnapshot = { candidates: view.candidates, groups: view.groups, selectedKeys: view.candidates.map((c) => c.key), resolutions: [], operations: KS_OPS_DEFAULT.map((o) => ({ ...o, on: false })), collection: "Custom", language: "English", standard: "Default", standardsRules: [], newSolutionTemplate: null, templateOverrides: [] };
    return snapshot;
  }
  async function post(body: unknown) {
    const response = await submitRoute(new Request("http://localhost/api/submit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
    const text = await response.text();
    return { status: response.status, events: text.trim().split("\n").map((line) => JSON.parse(line)) };
  }
  it("enforces preparation at the route, preserves client/server identity, and saves the graph", async () => {
    const snapshot = await fixture();
    const denied = await post({ runId, snapshot, action: "submit" });
    expect(denied.events.some((e) => e.type === "error")).toBe(true); expect(mocks.write).not.toHaveBeenCalled();
    const response = await post({ runId, snapshot, action: "prepare" });
    const event = response.events.find((e) => e.type === "result");
    expect(event).toBeDefined();
    const plan = buildWritePlan({ runId, candidates: snapshot.candidates, groups: snapshot.groups, selected: new Set(snapshot.selectedKeys), resolutions: [] });
    expect(event.reviewIdentity).toBe(submissionIdentity(plan, snapshot));
    expect((await readExecutedFlow(runId))!.graph!.counts.created).toBe(1);
    expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.flag).not.toHaveBeenCalled();
    const approvals = Object.fromEntries(event.results.map((r: { idempotencyKey: string; prepared: { version: string } }) => [r.idempotencyKey, r.prepared.version]));
    const submitted = await post({ runId, snapshot, action: "submit", approvals });
    expect(submitted.events.find((e) => e.type === "result")!.results[0].outcome).toBe("ok");
    expect(mocks.restructure).toHaveBeenCalledTimes(1);
  });
  it("invalidates prepared drafts when metadata changes and rejects stale submission", async () => {
    const snapshot = await fixture();
    const first = await post({ runId, snapshot, action: "prepare" });
    const old = first.events.find((e) => e.type === "result")!.results[0];
    const changed = { ...snapshot, language: "French" };
    const rejected = await post({ runId, snapshot: changed, action: "submit", approvals: { [old.idempotencyKey]: old.prepared.version } });
    expect(rejected.events.find((e) => e.type === "error").message).toContain("plan changed"); expect(mocks.write).not.toHaveBeenCalled();
    const second = await post({ runId, snapshot: changed, action: "prepare" });
    expect(second.events.find((e) => e.type === "result")!.results[0].prepared.version).not.toBe(old.prepared.version);
  });
  it("keeps submitted plans immutable and preserves completed writes", async () => {
    const execution: ExecuteArgs = { ...args([newOp()]), stage: "preparation", reviewIdentity: "first" };
    await savePreparationPlan(runId, execution);
    const [ready] = await executeWritePlan({ ...execution, prepareOnly: true });
    await freezePreparedPlan(runId, execution);
    await executeWritePlan({ ...execution, requirePrepared: true, approvals: { [ready.idempotencyKey]: ready.prepared!.version } });
    await expect(savePreparationPlan(runId, { ...execution, reviewIdentity: "different" })).rejects.toThrow("Submission has started");
    expect((await loadExecution<ExecuteArgs>(runId))!.reviewIdentity).toBe("first");
    expect((await getWriteState(ready.idempotencyKey))!.status).toBe("ok");
  });
});

it("preserves per-article metadata through preparation and passes the same choices to create and revise", async () => {
  const first = { ...newOp("a"), metadata: { collections: ["first", "second"], taxonomies: ["Root//A"], language: "French" } };
  const second: WriteOp = {kind:"revise",candidateKey:source.id,solutionId:source.id,title:source.title,templateName:template.templateName,fields,rawContent:"Existing content",fromMerge:false,idempotencyKey:`${runId}:revise:${source.id}`,metadata:{collections:["other"],taxonomies:[]}};
  const ready = await executeWritePlan(args([first,second],{prepareOnly:true}));
  expect(ready.every(r=>r.outcome==="ready")).toBe(true);
  expect(ready[0].prepared?.metadata).toEqual(first.metadata);
  const written = await executeWritePlan(args([first,second]));
  expect(written.every(r=>r.outcome==="ok")).toBe(true);
  expect(mocks.write.mock.calls[0][0]).toMatchObject({collections:"first,second",taxonomies:"Root//A",language:"French"});
  expect(mocks.update.mock.calls[0][1]).toMatchObject({collections:"other",taxonomies:""});
});

describe("Ground Context preparation contract", () => {
  const referenceId = "260916000000008";
  async function attachReferences() {
    const reference = { ...source, id: referenceId };
    const groundContext = { selection: { enabled: true, referenceSolutionIds: [referenceId], guidance: "Use the policy." }, references: [referenceFromSolution(reference)], capturedAt: "2026-09-16" };
    await db().prepare("INSERT INTO run_ground_context(run_id,payload) VALUES (?,?)").run(runId, JSON.stringify(groundContext));
    mocks.ground.mockImplementation(async article => result({ ...article, fields: [{ fieldName: "Solution", fieldValue: "<p>Original answer with supported policy detail.</p>" }, fields[1]], evidence: [], issues: [] }));
    mocks.groundReview.mockResolvedValue({ evidence: [], issues: [] });
    return groundContext;
  }
  it("restores reference snapshots and enriches an existing article with restructuring disabled", async () => {
    const groundContext = await attachReferences();
    expect((await getRun(runId))?.groundContext).toEqual(groundContext);
    const op: WriteOp = { ...newOp(), kind: "revise", fromMerge: false, solutionId: source.id };
    const output = await executeWritePlan(args([op], { prepareOnly: true, restructureEnabled: false }));
    expect(output[0]).toMatchObject({ outcome: "ready", prepared: { groundContext, groundingEnriched: true } });
    expect(output[0].fields?.[0].fieldValue).toContain("supported policy");
    expect(mocks.restructure).not.toHaveBeenCalled();
    expect(mocks.ground).toHaveBeenCalledOnce();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("blocks reference write plans before invoking any writer or model", async () => {
    await attachReferences();
    await expect(executeWritePlan(args([{ ...newOp(), kind: "revise", fromMerge: false, solutionId: referenceId }]))).rejects.toThrow("cannot be written");
    expect(mocks.ground).not.toHaveBeenCalled();
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("keeps contradictions in review and rechecks edited content without re-enriching it", async () => {
    await attachReferences();
    mocks.groundReview.mockResolvedValueOnce({ evidence: [], issues: ["Conflicting audience requirements."] });
    const op = newOp();
    const first = await executeWritePlan(args([op], { prepareOnly: true }));
    expect(first[0]).toMatchObject({ outcome: "review", prepared: { readyForSubmission: false, grounding: { issues: ["Conflicting audience requirements."] } } });
    const second = await executeWritePlan(args([op], { prepareOnly: true, reviews: { [op.idempotencyKey]: { version: first[0].prepared!.version, fields } } }));
    expect(second[0].outcome).toBe("ready");
    expect(mocks.ground).toHaveBeenCalledOnce();
    expect(mocks.groundReview).toHaveBeenCalledTimes(2);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("blocks changed references before a prepared article is submitted", async () => {
    await attachReferences();
    const op = newOp();
    const first = await executeWritePlan(args([op], { prepareOnly: true }));
    expect(first[0].outcome).toBe("ready");
    mocks.solution.mockImplementation(async id => ({ ...source, id, title: id === referenceId ? "Changed policy" : source.title }));
    await expect(executeWritePlan(args([op], { requirePrepared: true, approvals: { [op.idempotencyKey]: first[0].prepared!.version } }))).rejects.toThrow("changed");
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("retains and reapplies reference evidence when regenerating a review draft", async () => {
    const groundContext = await attachReferences();
    mocks.groundReview.mockResolvedValue({ evidence: [], issues: ["Needs clarification."] });
    const op = newOp();
    const first = await executeWritePlan(args([op], { prepareOnly: true }));
    const regenerated = await executeWritePlan(args([op], { prepareOnly: true, reviews: { [op.idempotencyKey]: { version: first[0].prepared!.version, fields, regenerate: true } } }));
    expect(regenerated[0]).toMatchObject({ outcome: "review", prepared: { groundContext, groundingEnriched: true } });
    expect(mocks.ground).toHaveBeenCalledTimes(2);
    expect(mocks.write).not.toHaveBeenCalled();
  });
  it("keeps references out of candidates and duplicate merge groups", async () => {
    const groundContext = await attachReferences();
    const duplicateSearch = vi.spyOn(duplicateEngine, "findDuplicatesFor").mockImplementation(async (_candidate, options) => {
      expect(options?.exclude?.has(referenceId)).toBe(true);
      return { matches: [], costUsd: 0, retrieval: { searches: [], comparedIds: [], availableCount: 0, limit: 16, excludedIds: [referenceId] } };
    });
    const output = await runPipeline({ text: "Write a guide", sourceSolutionIds: [], operations: ["Find duplicates"], groundContext: groundContext.selection }, undefined, groundContext);
    expect(output.solutions).toHaveLength(1);
    expect(output.solutions[0].key).toBe("c0");
    expect(output.solutions[0].sourceIds).toEqual([]);
    expect(output.groups).toEqual([]);
    expect(mocks.plan.mock.calls[0][4]).toEqual(groundContext);
    expect(duplicateSearch).toHaveBeenCalledOnce();
    duplicateSearch.mockRestore();
  });
});