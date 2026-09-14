import { afterAll, expect, it, vi } from "vitest";
import { z } from "zod";
import { runOperation } from "./client";
import { withSourceContext } from "./source-context";
const parse = vi.hoisted(() => vi.fn(async () => ({ output_parsed: { answer: "ok" }, usage: { input_tokens: 10, output_tokens: 2 } })));
vi.mock("openai", () => ({ default: class { responses = { parse }; } }));
vi.mock("../ingest/image-store", () => ({ getImage: async () => ({ mime: "image/png", bytes: Buffer.from("original bytes") }) }));
afterAll(() => vi.unstubAllEnvs());
it("the SDK receives original bytes in editor order during planning and authoring", async () => {
 vi.stubEnv("OPENAI_API_KEY","test-only");
 const originals=[{label:"before",content:"BEFORE"},{label:"image",content:"original",imageId:"image-id"},{label:"after",content:"AFTER"}];
 for (const operation of ["plan","compose","restructure","mergeSections"]) {
  await withSourceContext(originals,()=>runOperation({operation,role:"Author",task:"Use these sources",blocks:[],schemaName:"answer",schema:z.object({answer:z.string()})}));
  const input = (parse.mock.calls.at(-1) as unknown as [{input: {content: unknown}[]}])[0].input;
  const content = input[1].content as {type:string;text?:string;image_url?:string}[];
  expect(content.map(p=>p.type)).toEqual(["input_text","input_text","input_image","input_text","input_text"]);
  expect(content[0].text).toContain("BEFORE");expect(content[3].text).toContain("AFTER");
  expect(content[2].image_url).toBe(`data:image/png;base64,${Buffer.from("original bytes").toString("base64")}`);
 }
});
