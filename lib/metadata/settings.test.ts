import { expect, it } from "vitest";
import { effectiveMetadata, metadataDecisionKey } from "./settings";
import { buildWritePlan } from "../pipeline/submit";
import { submissionIdentity } from "../ks/submission-plan";
import { snapshotSchema, runSchema } from "../api/validation";
import { KS_OPS_DEFAULT } from "../ks/data";
import type { ViewCandidate } from "../ks/model";
import type { DecisionSnapshot } from "../db/runs";
const c=(key:string):ViewCandidate=>({key,title:key,subtitle:"",action:"New",source:"Your content",why:"",templateName:"How To",fields:[],rawContent:"Content",duplicates:[],dupeGroup:null});
it("persists attribute triage without turning unvalidated candidates into write assignments", () => {
 const attribute = { kind: "attribute" as const, value: "Managed", label: "Device: Managed", attributeName: "Device", attributeSet: "Security", sourceEvidence: "managed device", researchIdentity: "research-v1", status: "accepted" as const };
 const decisions = { a: { [metadataDecisionKey(attribute)]: attribute } };
 const snapshot = { candidates: [], groups: [], selectedKeys: [], resolutions: [], operations: KS_OPS_DEFAULT, collection: "a", language: "English", standard: "", standardsRules: [], newSolutionTemplate: null, templateOverrides: [], metadata: { decisions } };
 expect(snapshotSchema.parse(snapshot).metadata?.decisions).toEqual(decisions);
 expect(metadataDecisionKey(attribute)).not.toBe(metadataDecisionKey({ ...attribute, attributeSet: "Other" }));
 expect(effectiveMetadata({ decisions }, "a")).toBeUndefined();
});
it("merges global defaults with overrides and distinguishes empty taxonomy from inheritance",()=>{
 const settings={global:{collections:["a"],taxonomies:["Root//Topic"],language:"English"},solutions:{c1:{collections:["b"],taxonomies:[]}}};
 expect(effectiveMetadata(settings,"c1")).toEqual({collections:["b"],taxonomies:[],language:"English"});
 expect(effectiveMetadata(settings,"c2")).toEqual(settings.global);
 expect(effectiveMetadata({},"c1")).toBeUndefined();
});
it("writes different metadata per resulting article, ignoring excluded candidates",()=>{
 const plan=buildWritePlan({runId:"r",candidates:[c("a"),c("b"),c("excluded")],groups:[],selected:new Set(["a","b"]),resolutions:[],metadata:{global:{collections:["global"]},solutions:{b:{collections:["own"],taxonomies:["Root//Own"]},excluded:{collections:["not-used"]}}}});
 expect(plan.map(o=>o.kind!=="flag"&&o.metadata)).toEqual([{collections:["global"]},{collections:["own"],taxonomies:["Root//Own"]}]);
});
it("applies an external merge survivor override to its write, never the flags",()=>{
 const existing="260913000000001";
 const plan=buildWritePlan({runId:"r",candidates:[{...c("a"),dupeGroup:0}],groups:[{survivorId:existing,averageSimilarity:90,reason:"same",members:[{id:existing,title:"Existing",stat:"",retained:true},{id:"a",title:"a",stat:"",retained:false}]}],selected:new Set(["a"]),resolutions:["merged"],metadata:{solutions:{[existing]:{taxonomies:["Root//Merged"]}}}});
 expect(plan[0]).toMatchObject({kind:"revise",candidateKey:existing,metadata:{taxonomies:["Root//Merged"]}});
});
it("accepts the seventh operation and legacy six-operation snapshots",()=>{
 expect(runSchema.parse({text:"test",operations:["Discover and suggest metadata"]}).operations).toHaveLength(1);
 const snapshot={candidates:[],groups:[],selectedKeys:[],resolutions:[],operations:KS_OPS_DEFAULT.filter(o=>o.name!=="Discover and suggest metadata"),collection:"a",language:"English",standard:"",standardsRules:[],newSolutionTemplate:null,templateOverrides:[]};
 expect(snapshotSchema.safeParse(snapshot).success).toBe(true);
 expect(snapshotSchema.safeParse({...snapshot,operations:KS_OPS_DEFAULT}).success).toBe(true);
 const before=submissionIdentity([],snapshot as DecisionSnapshot);
 expect(submissionIdentity([],{...snapshot,metadata:{global:{taxonomies:["Root"]}}} as DecisionSnapshot)).not.toBe(before);
});
