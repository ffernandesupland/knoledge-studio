import { afterAll, beforeAll, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeDatabase, useDatabase } from "../db";
import { storeImage, getImage, assertImageOwnership } from "./image-store";
import { createRun, getRun } from "../db/runs";
import type { SourceBlock } from "../ks/source-document";
let dir:string;
beforeAll(()=>{dir=mkdtempSync(join(tmpdir(),"ks-images-"));useDatabase(join(dir,"test.db"));});
afterAll(()=>{closeDatabase();rmSync(dir,{recursive:true,force:true});});
it("preserves original image bytes across chunks and restricts access to the author",async()=>{
 const bytes=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),Buffer.alloc(700000,42)]);
 const id=await storeImage("alice","screen.png",bytes);
 expect((await getImage(id,"alice")).bytes.equals(bytes)).toBe(true);
 await expect(getImage(id,"bob")).rejects.toThrow("Image not found");
 await expect(assertImageOwnership({text:"",attachments:[{label:"x",text:"",imageId:id}]},"bob")).rejects.toThrow("Image not found");
 await assertImageOwnership({text:"",attachments:[{label:"x",text:"",imageId:id}]},"alice");
});
it("restores source order and original-image references with the run",async()=>{
 const content:SourceBlock[]=[{id:"before",type:"text",text:"before"},{id:"image-block",type:"attachment",attachmentId:"a"},{id:"after",type:"text",text:"after"}];
 const attachments=[{id:"a",label:"screen.png",text:"Original image",imageId:"stored-id"}];
 await createRun({id:"ordered",author:"alice",path:"create",inputText:"before\nafter",sourceIds:[],operations:[],content,attachments});
 const run=await getRun("ordered");
 expect(run?.content).toEqual(content);expect(run?.attachments).toEqual(attachments);
});
