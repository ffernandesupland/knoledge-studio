import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase, db, useDatabase } from "../db";
import { enqueue, claim, checkpoint, getJob, events } from "./store";
import { POST as advanceRoute } from "../../app/api/autonomous/advance/route";
import { POST as resumeRoute } from "../../app/api/autonomous/resume/route";
import { GET as statusRoute } from "../../app/api/autonomous/route";
import { GET as historyRoute } from "../../app/api/runs/executions/route";
import { readNdjson } from "../ks/stream";
import { processJob } from "./runner";
import { executionResults, getWriteState, loadExecution } from "../pipeline/state";
import type { PreparedContent, ExecuteArgs } from "../pipeline/execute";
import type { RunOutput } from "../pipeline/run";
import { readExecutedFlow } from "../flow/executions";
import { getRun } from "../db/runs";
import { decisionSnapshot, validateQuality, type QualityDecision } from "./decisions";

const mocks = vi.hoisted(() => ({ pipeline: vi.fn(), model: vi.fn(), write: vi.fn(), update: vi.fn(), flag: vi.fn(), author: vi.fn(), merge: vi.fn(), solution: vi.fn(), search: vi.fn() }));
vi.mock("../pipeline/run", () => ({ runPipeline: mocks.pipeline }));
vi.mock("../llm/client", () => ({ runOperation: mocks.model }));
vi.mock("../llm/operations", () => ({ restructure: mocks.author, mergeSections: mocks.merge, applyStandards: vi.fn() }));
vi.mock("../ra/client", () => ({ withRaActor: (_: string, fn: () => unknown) => fn(), ra: {
  getTemplates: async () => [template], getCollections: async () => [{ code: "support" }], search: mocks.search,
  getSolution: mocks.solution, getSolutionHtml: mocks.solution, manageSolution: mocks.write, updateSolution: mocks.update, flagMergedInto: mocks.flag,
} }));
const template = { templateName: "How To (RA)", templateType: "standard", kbPrefix: "", fields: [{ fieldName: "Solution", description: "", required: true, searchable: true }] };
const sourceText = "Open settings and import the verified VPN profile supplied by IT.";
const fields = [{ fieldName: "Solution", fieldValue: `<p>${sourceText}</p>` }];
const article = { title: "Connect to VPN", summary: "Import the verified profile.", keywords: ["VPN"], fields };
const input = { text: sourceText, operations: [] as [], standardsRules: [] };
const result = <T>(data: T) => ({ data, model: "test", costUsd: 0, inputTokens: 0, outputTokens: 0 });
const proposal = (key: string) => ({ key, title: `Connect to VPN ${key}`, summary: "", keywords: [], templateName: template.templateName, fields: [], rawContent: sourceText, source: "Your content" as const, rationale: "Supported distinct topic", duplicates: [] });
const analysis = (count = 1): RunOutput => ({ solutions: Array.from({ length: count }, (_, i) => proposal(`c${i}`)), groups: [], costUsd: 0, steps: [] });
const accept = (p: PreparedContent): QualityDecision => ({ verdict: "accept", explanation: "All content matches the verified source, so no revision is necessary.", evidence: [{ sourceId: p.sourceDocuments![0].id, quote: sourceText }], title: p.title, summary: p.summary, keywords: p.keywords, fields: p.fields });
const decide = (run: { candidates: { key: string }[]; groups: { survivorId: string }[] }) => ({ candidates: run.candidates.map(c => ({ key: c.key, keep: true, templateName: template.templateName, explanation: "A useful supported topic that should be retained.", evidence: [c.key] })), groups: run.groups.map((g, index) => ({ index, survivorId: g.survivorId, decision: "merged" as const, explanation: "The same task is supported by these compatible source articles.", evidence: [g.survivorId] })), metadata: { collection: "support", language: "English", explanation: "The support collection matches this English source.", evidence: [run.candidates[0].key] } });
let dir: string, id: string, counter = 0;
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "ks-auto-runner-")); useDatabase(path.join(dir, "test.db")); });
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.resetAllMocks(); id = `auto-runner-${++counter}`;
  await db().prepare("UPDATE autonomous_jobs SET status='failed' WHERE status IN ('queued','running')").run();
  mocks.pipeline.mockResolvedValue(analysis());
  mocks.search.mockImplementation(async params => {
    if (params.returnTypes !== "taxonomies,languages") throw new Error("HTTP 500: unsupported languages-only facet request");
    return { languages: ["English"] };
  });
  mocks.author.mockResolvedValue(result(article));
  mocks.write.mockResolvedValue("Created 260909000000003");
  mocks.update.mockResolvedValue({ solutionId: "260909000000004", mode: "revision", request: {} });
  mocks.flag.mockResolvedValue("ok");
  mocks.solution.mockImplementation(async id => ({ id, title: "VPN guide", templateName: template.templateName, status: "Published", fields: [{ name: "Solution", content: fields[0].fieldValue }] }));
  mocks.merge.mockResolvedValue(result({ ...article, sections: [{ fieldName: "Solution", combined: fields[0].fieldValue, contributions: [], noMatchNote: "", conflict: { present: false, optionA: { from: "", text: "" }, optionB: { from: "", text: "" }, mergedDefault: "" } }] }));
  mocks.model.mockImplementation(async args => {
    const block = JSON.parse(args.blocks.at(-1).content);
    return result(args.operation === "autonomousDecide" ? decide(block) : accept(block.prepared));
  });
});
async function run() { await enqueue(id, "sauser", input); const lease = (await claim())!; await processJob(lease.job, lease.token); return lease; }

describe("autonomous pipeline with the real preparation and write engine", () => {
  it("shows the saved result after a metadata failure and resumes without repeating analysis", async () => {
    mocks.pipeline.mockResolvedValue(analysis(7));
    mocks.search.mockRejectedValueOnce(new Error("RightAnswers is temporarily unavailable (HTTP 500)"));
    await run();
    const response = await statusRoute(new Request(`http://localhost/api/autonomous?runId=${id}`));
    const status = await response.json();
    expect(status).toMatchObject({ status: "failed", outcome: { failedStage: "Choose actions and metadata", submitted: 0, prepared: 0, canResume: true } });
    expect(status.outcome.proposals).toHaveLength(7);
    expect(status.graph).toBeUndefined();
    expect(status.outcome.stages.map((s: { status: string }) => s.status)).toEqual(["completed", "stopped", "pending", "pending", "pending"]);
    expect((await readExecutedFlow(id))?.outcome?.failedStage).toBe("Choose actions and metadata");
    // Existing production histories predate the result summary. Backfill them on read.
    const oldFlow = (await readExecutedFlow(id))!;
    delete oldFlow.outcome;
    await db().prepare("UPDATE flow_executions SET payload=? WHERE run_id=?").run(JSON.stringify(oldFlow), id);
    const history = await (await historyRoute(new Request(`http://localhost/api/runs/executions?runId=${id}`))).json();
    expect(history.outcome).toMatchObject({ failedStage: "Choose actions and metadata", submitted: 0 });
    expect(mocks.write).not.toHaveBeenCalled();
    const resumeRequest = () => new Request("http://localhost/api/autonomous/resume", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: id }) });
    expect((await resumeRoute(resumeRequest())).status).toBe(200);
    expect((await resumeRoute(resumeRequest())).status).toBe(409);
    const lease = (await claim(id))!;
    await processJob(lease.job, lease.token);
    expect((await getJob(id))?.status).toBe("completed");
    expect(mocks.pipeline).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledTimes(7);
    const final = await (await statusRoute(new Request(`http://localhost/api/autonomous?runId=${id}`))).json();
    expect(final.outcome).toMatchObject({ submitted: 7, prepared: 7, canResume: false });
    expect(final.outcome.stages.every((s: { status: string }) => s.status === "completed")).toBe(true);
    expect((await resumeRoute(resumeRequest())).status).toBe(409);
  });
  it("shows an analysis failure as a final outcome without inventing proposals or outputs", async () => {
    mocks.pipeline.mockRejectedValueOnce(new Error("Source unavailable"));
    await run();
    const status = await (await statusRoute(new Request(`http://localhost/api/autonomous?runId=${id}`))).json();
    expect(status.outcome).toMatchObject({ failedStage: "Analyze sources", submitted: 0, proposals: [], canResume: false });
    expect(status.outcome.stages.map((s: { status: string }) => s.status)).toEqual(["stopped", "pending", "pending", "pending", "pending"]);
  });
  it("advances the selected run from the app through saved steps without processing another queued run", async () => {
    await enqueue(`${id}-other`, "someone-else", input);
    await enqueue(id, "sauser", input);
    const advance = async (runId: string) => advanceRoute(new Request("http://localhost/api/autonomous/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId }) }));
    expect((await advance(`${id}-other`)).status).toBe(404);
    const seenStages: string[] = [];
    for (let step = 0; step < 12; step++) {
      const response = await advance(id);
      await readNdjson(response, () => {});
      const saved = (await getJob(id))!;
      seenStages.push(saved.stage);
      if (saved.status === "completed") break;
    }
    expect(seenStages).toEqual(["analysis", "decisions", "preparation", "review", "submission", "finished"]);
    expect((await getJob(`${id}-other`))?.status).toBe("queued");
    expect(mocks.pipeline).toHaveBeenCalledTimes(1);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    await readNdjson(await advance(id), () => {});
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });
  it("does not duplicate a step when another browser request holds its lease", async () => {
    await enqueue(id, "sauser", input);
    await claim(id);
    const response = await advanceRoute(new Request("http://localhost/api/autonomous/advance", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ runId: id }) }));
    const messages: Record<string, unknown>[] = [];
    await readNdjson(response, m => messages.push(m));
    expect(messages).toEqual([{ type: "result", status: "running", busy: true }]);
    expect(mocks.pipeline).not.toHaveBeenCalled();
  });
  it("makes choices, approves the exact prepared version and writes review drafts, saving the final graph", async () => {
    mocks.write.mockImplementation(async payload => {
      expect(payload).toMatchObject({ ...article, keywords: "VPN", status: "review", templateName: template.templateName, collections: "support", language: "English" });
      const approved = await checkpoint(id, `${"approved:"}${id}:create:c0`);
      expect(approved).toMatchObject({ actor: "agent", version: expect.any(String) });
      return "Created 260909000000003";
    });
    await run();
    expect((await getJob(id))?.status).toBe("completed"); expect(mocks.write).toHaveBeenCalledTimes(1);
    const flow = await readExecutedFlow(id);
    expect(flow?.mode).toBe("autonomous"); expect(flow?.graph?.rows[0].result?.outcome).toBe("ok");
    expect((await events(id)).some(e => e.kind === "decision" && e.explanation?.includes("matches"))).toBe(true);
    expect((await getRun(id))?.snapshot?.collection).toBe("support");
  });
  it("skips unsupported content and continues independently supported articles", async () => {
    mocks.pipeline.mockResolvedValue(analysis(2));
    mocks.model.mockImplementation(async args => {
      const block = JSON.parse(args.blocks.at(-1).content);
      if (args.operation === "autonomousDecide") return result(decide(block));
      return result({ ...accept(block.prepared), ...(block.prepared.sourceDocuments[0].id === "c0" ? { verdict: "skip", explanation: "There is not enough verified evidence for this article." } : {}) });
    });
    await run();
    expect((await getJob(id))?.status).toBe("partial"); expect(mocks.write).toHaveBeenCalledTimes(1);
    const results = await executionResults(id); expect(results.map(r => r.outcome)).toEqual(["review", "ok"]);
  });
  it("revises invalid metadata, validates it, and reviews the new version before writing", async () => {
    mocks.author.mockResolvedValue(result({ ...article, summary: "<p>Invalid HTML summary</p>" }));
    mocks.model.mockImplementation(async args => {
      const block = JSON.parse(args.blocks.at(-1).content);
      if (args.operation === "autonomousDecide") return result(decide(block));
      const p = block.prepared;
      return result(p.summary.includes("<") ? { ...accept(p), verdict: "revise", summary: article.summary, explanation: "Remove HTML tags from the summary; preserve the supported facts." } : accept(p));
    });
    await run();
    expect((await getJob(id))?.status).toBe("completed");
    const reviews = mocks.model.mock.calls.filter(([a]) => a.operation === "autonomousReview"); expect(reviews).toHaveLength(2);
    const first = JSON.parse(reviews[0][0].blocks[0].content).prepared.version;
    const second = JSON.parse(reviews[1][0].blocks[0].content).prepared.version;
    expect(first).not.toBe(second);
    expect(await checkpoint(id, `approved:${id}:create:c0`)).toMatchObject({ version: second });
    expect(mocks.author).toHaveBeenCalledTimes(1);
  });
  it("bounds quality corrections and never writes an endlessly revised article", async () => {
    mocks.model.mockImplementation(async args => {
      const block = JSON.parse(args.blocks.at(-1).content);
      return result(args.operation === "autonomousDecide" ? decide(block) : { ...accept(block.prepared), verdict: "revise" });
    });
    await run();
    expect((await getJob(id))?.status).toBe("partial"); expect(mocks.write).not.toHaveBeenCalled();
    expect(mocks.model.mock.calls.filter(([a]) => a.operation === "autonomousReview")).toHaveLength(3);
  });
  it("does not replay completed writes or an uncertain POST after a worker restart", async () => {
    mocks.pipeline.mockResolvedValue(analysis(2));
    mocks.write.mockResolvedValueOnce("Created 260909000000003").mockRejectedValueOnce(new Error("Connection lost after POST"));
    await run(); expect((await getJob(id))?.status).toBe("partial");
    expect((await executionResults(id)).map(r => r.outcome)).toEqual(["ok", "uncertain"]);
    await db().prepare("UPDATE autonomous_jobs SET status='running', lease_until=0 WHERE run_id=?").run(id);
    const resumed = (await claim())!; await processJob(resumed.job, resumed.token);
    expect(mocks.pipeline).toHaveBeenCalledTimes(1); expect(mocks.write).toHaveBeenCalledTimes(2);
    expect((await executionResults(id)).map(r => r.outcome)).toEqual(["ok", "uncertain"]);
  });
  it("merges into the retained existing article and adds comments only after its revision succeeds", async () => {
    const output = analysis();
    output.groups = [{ survivorId: "260909000000010", averageSimilarity: 95, rationales: ["Same user need"], members: [{ id: "c0", title: "Proposal", isNew: true, viewCount: 0 }, { id: "260909000000010", title: "Retained VPN", isNew: false, viewCount: 12 }, { id: "260909000000011", title: "Old VPN", isNew: false, viewCount: 1 }] }];
    mocks.pipeline.mockResolvedValue(output);
    mocks.flag.mockImplementation(async () => { expect(mocks.update).toHaveBeenCalledTimes(1); return "ok"; });
    await run();
    expect((await getJob(id))?.status).toBe("completed"); expect(mocks.write).not.toHaveBeenCalled(); expect(mocks.flag).toHaveBeenCalledTimes(1);
    expect((await readExecutedFlow(id))?.graph?.rows[0].sources).toHaveLength(3);
    const plan = (await loadExecution<ExecuteArgs>(id))!.plan;
    expect(plan.map(p => p.kind)).toEqual(["revise", "flag"]);
  });
  it("rejects unknown agent targets and fabricated source evidence without writing", async () => {
    await run(); const stored = (await getRun(id))!;
    const decisions = decide(stored); decisions.candidates[0].key = "made-up";
    expect(() => decisionSnapshot(stored, input, { templates: [template], collections: [{ code: "support" }], languages: ["English"] }, decisions)).toThrow();
    const prepared = (await getWriteState(`${id}:create:c0`))!.prepared!;
    expect(() => validateQuality(prepared, { ...accept(prepared), evidence: [{ sourceId: "c0", quote: "Unverified words not present" }] })).toThrow("not present");
    expect(() => validateQuality(prepared, { ...accept(prepared), title: "Sneaky edit" })).toThrow("silently edit");
  });
});
