import { expect, it } from "vitest";
import { insertSources, orderedSources, type SourceBlock } from "./source-document";
import { runSchema } from "../api/validation";
it("inserts multiple files at the selection without changing surrounding text or file order", () => {
  let n = 0;
  const blocks = insertSources([{id:"a",type:"text",text:"Before AFTER"}],"a",7,7,["first","second"],()=>`id-${n++}`);
  const result = orderedSources({text:"ignored legacy text",content:blocks,attachments:[
    {id:"second",label:"second.pdf",text:"PDF content"},
    {id:"first",label:"first.png",text:"Original image",imageId:"image-id"},
  ]});
  expect(result.map(b=>b.content)).toEqual(["Before ","Original image","PDF content","AFTER"]);
  expect(result[1].imageId).toBe("image-id");
});
it("replaces selected text and retains all text after it", () => {
  let n=0;
  const blocks=insertSources([{id:"a",type:"text",text:"before REMOVE after"}],"a",7,13,["image"],()=>`id-${n++}`);
  expect(blocks.filter(b=>b.type==="text").map(b=>b.text)).toEqual(["before "," after"]);
});
it("rejects missing, duplicate or omitted editor sources at the API boundary", () => {
  const content:SourceBlock[]=[{id:"a",type:"attachment",attachmentId:"image"}];
  expect(runSchema.safeParse({text:"",operations:[],content,attachments:[]}).success).toBe(false);
  expect(runSchema.safeParse({text:"",operations:[],content,attachments:[{id:"image",label:"image",text:"x"}]}).success).toBe(true);
  expect(runSchema.safeParse({text:"",operations:[],content:[...content,{...content[0],id:"b"}],attachments:[{id:"image",label:"image",text:"x"}]}).success).toBe(false);
});
it("accepts an original file ID but strips a forged file owner", () => {
  const parsed = runSchema.parse({ text: "", operations: [], content: [{ id: "a", type: "attachment", attachmentId: "pdf" }], attachments: [{ id: "pdf", label: "source.pdf", text: "Original PDF attached", fileId: "11111111-1111-4111-8111-111111111111", fileOwner: "forged-owner" }] });
  expect(parsed.attachments?.[0].fileId).toBe("11111111-1111-4111-8111-111111111111");
  expect(parsed.attachments?.[0]).not.toHaveProperty("fileOwner");
});
it("accepts documents without typed text and preserves mixed source order", () => {
  const content: SourceBlock[] = [
    { id: "pdf", type: "attachment", attachmentId: "manual" },
    { id: "text", type: "text", text: "Use the approved revision only." },
    { id: "word", type: "attachment", attachmentId: "procedure" },
  ];
  const attachments = [
    { id: "manual", label: "manual.pdf", text: "PDF manual", fileId: "11111111-1111-4111-8111-111111111111" },
    { id: "procedure", label: "procedure.docx", text: "Word procedure", fileId: "22222222-2222-4222-8222-222222222222" },
  ];

  expect(runSchema.safeParse({ text: "", operations: [], content, attachments }).success).toBe(true);
  expect(orderedSources({ text: "", content, attachments }).map((source) => source.label)).toEqual(["manual.pdf", "Text 2", "procedure.docx"]);
});
