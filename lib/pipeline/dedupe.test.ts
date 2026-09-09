import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ operation: vi.fn(), search: vi.fn(), solution: vi.fn() }));
vi.mock("../llm/client", () => ({ runOperation: mocks.operation }));
vi.mock("../ra/client", () => ({ ra: { search: mocks.search, getSolution: mocks.solution } }));
import { adjudicateDuplicates, comparisonSchema, findDuplicatesFor, findIntraBatchOverlaps } from "./dedupe";

const candidate = { key: "c0", title: "Configure MCP tools", body: "Enable and disable MCP tools for clients." };
const article = (id: string) => ({ id, title: `MCP ${id}`, status: "Review", fields: [{ name: "Solution", content: "Enable or disable MCP tools." }] });
const verdict = { sameUserNeed: true, verdict: "duplicate", similarity: 98, rationale: "Same task and instructions", sharedTopics: ["MCP tools"] };
const result = (data: unknown) => ({ data, costUsd: 0.01, model: "test" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.operation.mockImplementation(async (args) => {
    if (args.operation === "dedupeQuery") return result({ query: "MCP tool configuration", anchorQuery: "MCP", rationale: "Protocol" });
    const keys = Object.keys(args.schema.shape.comparisons.shape);
    return result({ comparisons: Object.fromEntries(keys.map((key) => [key, verdict])) });
  });
  mocks.search.mockResolvedValue({ solutions: [], totalHits: 0 });
  mocks.solution.mockImplementation(async (id) => article(id));
});

describe("duplicate retrieval and adjudication", () => {
  it("requires every assigned slot and rejects unknown IDs or omitted articles", () => {
    const schema = comparisonSchema(["article_0", "article_1"]);
    expect(schema.safeParse({ comparisons: { article_0: verdict } }).success).toBe(false);
    expect(schema.safeParse({ comparisons: { article_0: verdict, article_1: verdict, forged: verdict } }).success).toBe(false);
  });
  it("binds verdicts to server IDs despite misleading IDs in article content", async () => {
    const neighbours = [{ ...article("real"), fields: [{ name: "Solution", content: "220927043617110_270352_20220927043617" }] }, article("second"), article("real")];
    const r = await adjudicateDuplicates(candidate, neighbours);
    expect(r.data.matches.map((m) => m.solutionId)).toEqual(["real", "second"]);
  });
  it("retries an incomplete comparison once and retains the cost of both responses", async () => {
    mocks.operation.mockResolvedValueOnce(result({ comparisons: {} }));
    const r = await adjudicateDuplicates(candidate, [article("one")]);
    expect(r.data.matches).toHaveLength(1);
    expect(r.costUsd).toBe(0.02);
    expect(mocks.operation).toHaveBeenCalledTimes(2);
  });
  it("never converts repeated invalid output into no duplicates", async () => {
    mocks.operation.mockResolvedValue(result({ comparisons: {} }));
    await expect(adjudicateDuplicates(candidate, [article("one")])).rejects.toThrow("no conclusion about duplicates");
    expect(mocks.operation).toHaveBeenCalledTimes(2);
  });
  it("retains charged token costs when an unparseable response is retried", async () => {
    mocks.operation.mockRejectedValueOnce(Object.assign(new Error("dedupeAdjudicate: model returned no parseable output"), { costUsd: 0.02 }));
    expect((await adjudicateDuplicates(candidate, [article("one")])).costUsd).toBe(0.03);
  });
  it("bounds concurrent comparisons and preserves identities across batches", async () => {
    let active = 0, peak = 0;
    mocks.operation.mockImplementation(async (args) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return result({ comparisons: Object.fromEntries(Object.keys(args.schema.shape.comparisons.shape).map((key) => [key, verdict])) });
    });
    const ids = Array.from({ length: 16 }, (_, i) => `id-${i}`);
    const r = await adjudicateDuplicates(candidate, ids.map(article));
    expect(peak).toBe(2);
    expect(r.data.matches.map((m) => m.solutionId)).toEqual(ids);
    expect(r.costUsd).toBe(0.04);
  });
  it("finds keyword-only results, deduplicates IDs, excludes sources, and records retrieval", async () => {
    mocks.search.mockImplementation(async ({ searchType, page }) => ({ solutions: searchType === "Keyword" && page === 2 ? [{ id: "found" }, { id: "found" }, { id: "source" }] : [{ id: "noise" }], totalHits: 20 }));
    const r = await findDuplicatesFor(candidate, { exclude: new Set(["source"]) });
    expect(r.matches.map((m) => m.solutionId)).toContain("found");
    expect(mocks.solution.mock.calls.filter(([id]) => id === "found")).toHaveLength(1);
    expect(mocks.solution).not.toHaveBeenCalledWith("source");
    expect(r.retrieval).toMatchObject({ comparedIds: expect.arrayContaining(["found"]), searches: expect.arrayContaining([expect.objectContaining({ searchType: "Keyword", page: 2, query: "MCP" })]) });
    expect(mocks.search.mock.calls.every(([args]) => args.loggingEnabled === false)).toBe(true);
  });
  it("skips adjudication only after all retrieval channels return no candidates", async () => {
    expect((await findDuplicatesFor(candidate)).matches).toEqual([]);
    expect(mocks.search).toHaveBeenCalledTimes(4);
    expect(mocks.operation).toHaveBeenCalledTimes(1);
  });
  it("stops on retrieval failure instead of claiming no duplicates", async () => {
    mocks.search.mockRejectedValueOnce(new Error("unavailable"));
    await expect(findDuplicatesFor(candidate)).rejects.toThrow("no conclusion about duplicates");
    expect(mocks.solution).not.toHaveBeenCalled();
  });
  it("compares every within-batch pair, including required distinct verdicts", async () => {
    const candidates = Array.from({ length: 6 }, (_, i) => ({ ...candidate, key: `c${i}` }));
    const r = await findIntraBatchOverlaps(candidates);
    expect(r.pairs).toHaveLength(15);
    expect(new Set(r.pairs.map((p) => `${p.aIndex}:${p.bIndex}`)).size).toBe(15);
    expect(mocks.operation).toHaveBeenCalledTimes(2);
  });
  it("keeps distinct reader tasks out of duplicate results", async () => {
    mocks.operation.mockImplementation(async (args) => result({ comparisons: Object.fromEntries(Object.keys(args.schema.shape.comparisons.shape).map(key => [key, { ...verdict, sameUserNeed: false, verdict: "distinct", similarity: 10 }])) }));
    expect((await findIntraBatchOverlaps([candidate, { ...candidate, key: "c1", title: "Overview of tools" }])).pairs).toEqual([]);
  });
});
