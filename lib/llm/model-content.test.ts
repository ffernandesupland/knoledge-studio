import { expect, it } from "vitest";
import { orderedModelContent } from "./model-content";
import { withSourceContext, sourceContext } from "./source-context";
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
