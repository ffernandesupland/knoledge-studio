import { beforeEach, expect, it, vi } from "vitest";
import type { WSSolution } from "../ra/types";
import type { MetadataOption } from "./types";
import { zodTextFormat } from "openai/helpers/zod";
const mocks = vi.hoisted(() => ({ getSolution: vi.fn(), getCollections: vi.fn(), getBrowsePaths: vi.fn(), search: vi.fn(), runOperation: vi.fn() }));
vi.mock("../ra/client", () => ({ ra: mocks }));
vi.mock("../llm/client", () => ({ runOperation: mocks.runOperation }));
import { analyzeMetadata, shortlist, sourceText, usableExamples, validateRecommendations, RecommendationSchema } from "./engine";
it("builds an API-compatible structured-output schema including reference evidence", () => {
 expect(() => zodTextFormat(RecommendationSchema, "metadata_recommendations")).not.toThrow();
});
const target: WSSolution = { id: "target", title: "Reset a RightAnswers password", status: "Published", collections: ["support"], taxonomy: ["Wrong label"], fields: [{ name: "Steps", content: "Use the password reset link in RightAnswers." }] };
const option: MetadataOption = { id: "c:0", kind: "collection", value: "support", label: "Support", origin: "catalog" };
const suggestion = { candidateId: option.id, reason: "Support task", sourceEvidence: "password reset link", exampleIds: ["example"] };
const example = { id: "example", title: "Account recovery", summary: "", collections: ["support"], taxonomy: [] };
beforeEach(() => vi.resetAllMocks());
it("excludes self, same-title copies, direct revisions, drafts and duplicate examples", () => {
 const valid = { ...target, id: "good", title: "Account recovery" };
 expect(usableExamples([target, { ...target, id: "copy" }, { ...valid, id: "revision", revisionID: "target" }, { ...valid, id: "draft", status: "Draft" }, valid, valid, { ...valid, id: "other-copy" }], target).map(s=>s.id)).toEqual(["good"]);
});
it("rejects invented candidates, examples, duplicate recommendations and fabricated source excerpts", () => {
 const check = (suggestions: typeof suggestion[]) => validateRecommendations({ rationale: "", uncertainties: [], suggestions }, [option], [example], target);
 expect(check([suggestion])[0].alreadyAssigned).toBe(true);
 expect(() => check([{ ...suggestion, candidateId: "invented" }])).toThrow("unknown");
 expect(() => check([{ ...suggestion, exampleIds: ["inaccessible"] }])).toThrow("outside");
 expect(() => check([suggestion, suggestion])).toThrow("repeated");
 expect(() => check([{ ...suggestion, sourceEvidence: "Invented audience" }])).toThrow("excerpt");
});
it("shortlists thousands of labels without discarding a late exact product match", () => {
 const items = [...Array.from({ length: 5000 }, (_, i) => `General ${i}`), "RightAnswers password"];
 expect(shortlist(items, s=>s, "RightAnswers password", 60)[0]).toBe("RightAnswers password");
 expect(shortlist(items, s=>s, "RightAnswers password", 60)).toHaveLength(60);
});
it("bounds long fields and retains text from later sections", () => {
 const text = sourceText({ ...target, fields: [{name:"First",content:"x".repeat(100000)},{name:"Last",content:"IMPORTANT"}] });
 expect(text.length).toBeLessThan(37000); expect(text).toContain("IMPORTANT");
});
it("runs scoped read-only research, explores child paths and hides existing target labels from prompts", async () => {
 mocks.getSolution.mockResolvedValue(target);
 mocks.getCollections.mockResolvedValue([{code:"support",displayName:"Support"}]);
 mocks.getBrowsePaths.mockImplementation(async (path: string) => path === "RightAnswers" ? [{value:"RightAnswers//Accounts",hitCount:2}] : path === "" ? [{value:"RightAnswers",hitCount:5}] : []);
 mocks.search.mockResolvedValue({solutions:[{id:"example",title:"Account recovery",verboseSolutionResult:{...target,id:"example",title:"Account recovery",taxonomy:["RightAnswers//Accounts"]}}]});
 mocks.runOperation.mockImplementation(async (args: {schemaName:string; blocks: {content:string}[]}) => ({inputTokens:10,outputTokens:5,costUsd:.001,data:args.schemaName === "metadata_search_plan" ? {queries:["RightAnswers password"],terms:["accounts"]} : args.schemaName === "metadata_branches" ? {paths:JSON.parse(args.blocks[1].content).includes("RightAnswers") ? ["RightAnswers"] : []} : {rationale:"Article fit",suggestions:[suggestion],uncertainties:[]}}));
 const r = await analyzeMetadata("target", {impUser:"alice"});
 expect(r.suggestions[0].option.value).toBe("support"); expect(r.coverage.browsedPaths).toContain("RightAnswers");
 expect(mocks.getSolution).toHaveBeenCalledWith("target",{impUser:"alice"});
 expect(mocks.search.mock.calls[0][0]).toMatchObject({statuses:"approved",loggingEnabled:false});
 expect(mocks.search.mock.calls[0][1]).toEqual({impUser:"alice"});
 expect(JSON.stringify(mocks.runOperation.mock.calls)).not.toContain("Wrong label");
 const routing=mocks.runOperation.mock.calls.find(([a])=>a.schemaName==="metadata_branches")![0];
 expect(routing.schema.safeParse({paths:["Invented//Branch"]}).success).toBe(true); // Membership is checked after parsing so customer labels need not be enum literals.
 const final=mocks.runOperation.mock.calls.find(([a])=>a.schemaName==="metadata_recommendations")![0];
 expect(final.schema.safeParse({rationale:"",uncertainties:[],suggestions:[{...suggestion,candidateId:"invented"}]}).success).toBe(false);
});
it("keeps strict-output candidate IDs safe when catalog values contain quotes", async () => {
 mocks.getSolution.mockResolvedValue(target);
 mocks.getCollections.mockResolvedValue([{ code: 'collection:"unsafe"', displayName: 'Collection "unsafe"' }]);
 mocks.getBrowsePaths.mockResolvedValue([]);
 mocks.search.mockResolvedValue({ solutions: [] });
 mocks.runOperation.mockImplementation(async (args: { schemaName: string }) => ({ inputTokens: 10, outputTokens: 5, costUsd: .001, data: args.schemaName === "metadata_search_plan" ? { queries: ["RightAnswers password"], terms: [] } : { rationale: "Article fit", suggestions: [{ ...suggestion, candidateId: "c:0", exampleIds: [] }], uncertainties: [] } }));
 const report = await analyzeMetadata("target", { impUser: "alice" });
 expect(report.suggestions[0].option).toMatchObject({ id: "c:0", value: 'collection:"unsafe"' });
 const final = mocks.runOperation.mock.calls.find(([a]) => a.schemaName === "metadata_recommendations")![0];
 expect(final.schema.safeParse({ rationale: "", uncertainties: [], suggestions: [{ ...suggestion, candidateId: "c:0", exampleIds: [] }] }).success).toBe(true);
});
it("stops before model calls when cancelled", async () => {
 mocks.getSolution.mockResolvedValue(target); const abort = new AbortController(); abort.abort();
 await expect(analyzeMetadata("target", {}, ()=>{}, abort.signal)).rejects.toThrow("cancelled");
 expect(mocks.runOperation).not.toHaveBeenCalled();
});

it("validates selected reference excerpts and records the supporting article field", () => {
  const context = { selection: { enabled: true, referenceSolutionIds: ["123456789012345"], guidance: "" }, capturedAt: "today", references: [{ id: "123456789012345", title: "Policy", status: "Published", body: "Employees must use the password reset link.", version: "v1" }] };
  const evidence = { referenceId: context.references[0].id, quote: "Employees must use the password reset link." };
  const data = { rationale: "", uncertainties: [], suggestions: [{ ...suggestion, referenceEvidence: [evidence] }] };
  const result = validateRecommendations(data, [option], [example], target, context);
  expect(result[0].referenceEvidence).toEqual([evidence]);
  expect(result[0].sourceFields).toEqual(["Steps"]);
  expect(() => validateRecommendations(data, [option], [example], target)).toThrow("absent");
  expect(() => validateRecommendations({ ...data, suggestions: [{ ...suggestion, referenceEvidence: [{ ...evidence, quote: "A fabricated statement about this policy." }] }] }, [option], [example], target, context)).toThrow("absent");
});
