import { withSourceContext } from "@/lib/llm/source-context";
import { orderedSources } from "@/lib/ks/source-document";
import { z } from "zod";
import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { readJson, canonicalSnapshot, assertOwner } from "@/lib/api/validation";
import { getRun } from "@/lib/db/runs";
import { assertGuided } from "@/lib/autonomous/store";
import { buildWritePlan } from "@/lib/pipeline/submit";
import { researchPipelineMetadata } from "@/lib/metadata/pipeline";
import { ra } from "@/lib/ra/client";
import { GroundReferenceChangedError } from "@/lib/ground-context/server";
export const dynamic = "force-dynamic";
export const maxDuration = 300;
export async function GET(request: Request) {
  try {
    const actor = await requireActor(request);
    const path = new URL(request.url).searchParams.get("path") ?? "";
    if (path.length > 1000) throw new ApiError("Taxonomy path is too long");
    return Response.json({ paths: await ra.getBrowsePaths(path,{impUser:actor}) },{headers:{"Cache-Control":"no-store"}});
  } catch(e) { return apiError(e); }
}
export async function POST(request: Request) {
  try {
    const actor = await requireActor(request);
    const input = await readJson(request,z.object({runId:z.string().max(100),key:z.string().max(100),snapshot:z.unknown()}));
    const run = await getRun(input.runId); assertOwner(run,actor); await assertGuided(run.id);
    const snapshot = canonicalSnapshot(run,input.snapshot);
    if (!snapshot.operations.some(o=>o.name === "Discover and suggest metadata" && o.on)) throw new ApiError("Enable metadata discovery first");
    const op = buildWritePlan({runId:run.id,candidates:snapshot.candidates,groups:snapshot.groups,selected:new Set(snapshot.selectedKeys),resolutions:snapshot.resolutions}).find(o=>o.kind!=="flag" && o.candidateKey===input.key);
    if (!op || op.kind === "flag") throw new ApiError("Select a resulting article before researching metadata");
    const encoder = new TextEncoder(), abort = new AbortController(); let connected = true;
    return new Response(new ReadableStream({
      async start(controller) {
        const send = (value:unknown) => { if(connected) try{controller.enqueue(encoder.encode(JSON.stringify(value)+"\n"));}catch{connected=false;abort.abort();} };
        try { const report = await withSourceContext(orderedSources({text:run.inputText,attachments:run.attachments,content:run.content}),()=>researchPipelineMetadata(run.id,op,{impUser:actor},message=>send({type:"progress",message}),abort.signal)); send({type:"result",report}); }
        catch(e){send({type:"error",message:e instanceof Error?e.message:"Metadata research failed", ...(e instanceof GroundReferenceChangedError ? { referenceChanges: e.changes } : {})});}
        finally{if(connected)controller.close();}
      },cancel(){connected=false;abort.abort();}
    }),{headers:{"Content-Type":"application/x-ndjson; charset=utf-8","Cache-Control":"no-store"}});
  }catch(e){return apiError(e);}
}
