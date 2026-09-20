import { expect, it, vi } from "vitest";
import { orderedModelContent } from "./model-content";
import { withSourceContext, sourceContext } from "./source-context";
const mocks = vi.hoisted(() => ({ getAgentFile: vi.fn() }));
vi.mock("../agent/file-store", () => ({ getAgentFile: mocks.getAgentFile }));
it("sends original images interleaved with neighbouring text, with task instructions last",async()=>{
 const parts=await orderedModelContent([
 {label:"Before",content:"first screen explanation"},
 {label:"screen.png",content:"original image",imageId:"original"},
 {label:"After",content:"then continue"},
 {label:"manual.pdf",content:"PDF instructions"},
 ],[],"Analyze this sequence",async id=>`data:image/png;base64,${id}`);
 expect(parts.map(p=>p.type)).toEqual(["input_text","input_text","input_image","input_text","input_text","input_text"]);
 expect(parts[0]).toMatchObject({text:expect.stringContaining("first screen explanation")});
 expect(parts[2]).toMatchObject({image_url:"data:image/png;base64,original",detail:"high"});
 expect(parts[3]).toMatchObject({text:expect.stringContaining("then continue")});
 expect(parts.at(-1)).toMatchObject({text:expect.stringContaining("TASK (from the operator")});
});
it("isolates concurrent runs' original visual context",async()=>{
 const work=(imageId:string)=>withSourceContext([{label:"image",content:"original",imageId}],async()=>{await Promise.resolve();return sourceContext()[0].imageId;});
 expect(await Promise.all([work("alice-image"),work("bob-image")])).toEqual(["alice-image","bob-image"]);
 expect(sourceContext()).toEqual([]);
});
it("sends an owned original document as an input file without extracting it", async () => {
 mocks.getAgentFile.mockResolvedValueOnce({ name: "source.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF") });
 const parts = await orderedModelContent([{ label: "source.pdf", content: "Original PDF attached", fileId: "file-id", fileOwner: "author" }], [], "Analyze it");
 expect(parts.map(part => part.type)).toEqual(["input_text", "input_file", "input_text"]);
 expect(parts[1]).toMatchObject({ filename: "source.pdf", file_data: "data:application/pdf;base64,JVBERg==" });
 expect(mocks.getAgentFile).toHaveBeenCalledWith("file-id", "author");
});
