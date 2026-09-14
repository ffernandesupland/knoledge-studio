import { ra, type RaContext } from "../ra/client";
import type { WriteOp } from "../pipeline/submit";
/** Validate controlled values against the actor's current catalogs before preparation or writes. */
export async function validatePlanMetadata(plan: WriteOp[], ctx: RaContext) {
  const selected=plan.flatMap(op=>op.kind!=="flag"&&op.metadata?[op.metadata]:[]);
  if(!selected.length)return;
  for (const op of plan) if(op.kind === "revise" && op.metadata?.taxonomies?.length === 0) {
    const parent=await ra.getSolution(op.solutionId,ctx);
    if(parent.taxonomy?.length)throw new Error("RightAnswers cannot clear all existing taxonomies through this API. Select a replacement path or reset the taxonomy override.");
  }
  const collections=await ra.getCollections(ctx);
  for(const values of selected) {
    if(values.collections?.some(code=>!collections.some(c=>c.code===code)))throw new Error("A selected collection is no longer available. Review metadata again.");
    if(values.collections && (!values.collections.length || new Set(values.collections).size!==values.collections.length))throw new Error("Select distinct collections for each article.");
  }
  const paths=[...new Set(selected.flatMap(v=>v.taxonomies??[]))];
  const parents=[...new Set(paths.map(p=>p.split("//").slice(0,-1).join("//")))];
  const valid=new Set<string>();
  for(const parent of parents){const children=await ra.getBrowsePaths(parent,ctx);children.forEach(p=>valid.add(p.value));}
  if(paths.some(p=>!valid.has(p)))throw new Error("A selected taxonomy is not available in the current catalog. Review the selected paths.");
  if(selected.some(v=>v.language)){const facets=await ra.search({returnTypes:"taxonomies,languages"},ctx);if(selected.some(v=>v.language&&!facets.languages?.includes(v.language)))throw new Error("A selected language is unavailable.");}
}
