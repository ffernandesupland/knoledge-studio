import { afterEach, expect, it, vi } from "vitest";
import { ra } from "./client";
afterEach(()=>vi.restoreAllMocks());
const source={id:"260913000000001",title:"Article",status:"Draft",templateName:"How To",collections:["old"],taxonomy:["Old//Topic"],language:"English"};
it("updates draft metadata with a major save and preserves the ID",async()=>{
 const write=vi.spyOn(ra,"manageSolution").mockResolvedValue("Successfully updated solution with ID: 260913000000001");
 const result=await ra.updateSolution(source,{collections:"new,second",taxonomies:"New//Topic",language:"French"},{impUser:"alice"});
 expect(result.mode).toBe("direct");expect(write).toHaveBeenCalledWith(expect.objectContaining({solutionID:source.id,minorSave:false,collections:"new,second",taxonomies:"New//Topic",language:"French"}),{impUser:"alice"});
});
it("keeps content-only minor saves and puts approved metadata on the new published revision",async()=>{
 const write=vi.spyOn(ra,"manageSolution").mockResolvedValue("Successfully updated solution with ID: 260913000000001");
 await ra.updateSolution(source,{title:"Edited"});expect(write.mock.calls[0][0]).toMatchObject({minorSave:true,solutionID:source.id});expect(write.mock.calls[0][0]).not.toHaveProperty("collections");
 write.mockResolvedValue("Successfully created solution with ID: 260913000000002");
 await ra.updateSolution({...source,status:"Published"},{collections:"new",taxonomies:"New//Topic"});
 expect(write.mock.calls[1][0]).toMatchObject({revisionParentID:source.id,minorSave:false,collections:"new",taxonomies:"New//Topic",language:"English"});expect(write.mock.calls[1][0]).not.toHaveProperty("solutionID");
});

it("does not pretend an empty taxonomy list clears existing labels",async()=>{const write=vi.spyOn(ra,"manageSolution");await expect(ra.updateSolution(source,{taxonomies:""})).rejects.toThrow("retains existing taxonomies");expect(write).not.toHaveBeenCalled();});
