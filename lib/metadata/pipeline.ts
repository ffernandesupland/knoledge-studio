import { createHash } from "node:crypto";
import { ra, type RaContext } from "../ra/client";
import type { WriteOp } from "../pipeline/submit";
import type { WSSolution } from "../ra/types";
import { db } from "../db";
import { withRunLock } from "../pipeline/state";
import { analyzeMetadataSource } from "./engine";
import { withAiAudit } from "../llm/audit";
import type { MetadataReport } from "./types";
import { getRun } from "../db/runs";
import { groundIdentity } from "../ground-context/types";
import { checkRunReferences } from "../ground-context/check-run";

export async function metadataSource(op: Exclude<WriteOp, {kind:"flag"}>, ctx: RaContext): Promise<WSSolution> {
  const parent = op.kind === "revise" ? await ra.getSolution(op.solutionId, ctx) : undefined;
  const body = op.rawContent || op.fields?.map(f => `${f.fieldName}: ${f.fieldValue}`).join("\n") || parent?.fields?.map(f => `${f.name}: ${f.content}`).join("\n") || "";
  const fields = [{ name: "Proposed article", content: body }];
  for (const source of op.mergeSources ?? []) {
    const existing = /^\d{15}$/.test(source.id) && !source.edited ? await ra.getSolution(source.id, ctx) : undefined;
    fields.push({ name: `Merge source: ${source.title}`, content: existing ? existing.fields?.map(f => `${f.name}: ${f.content}`).join("\n") ?? existing.summary ?? "" : source.rawContent || source.fields?.map(f => `${f.fieldName}: ${f.fieldValue}`).join("\n") || "" });
  }
  return { ...parent, id: parent?.id ?? op.candidateKey, title: op.title, summary: op.summary ?? parent?.summary, status: parent?.status ?? "Draft", templateName: op.templateName ?? parent?.templateName, fields };
}
export async function researchPipelineMetadata(runId: string, op: Exclude<WriteOp, {kind:"flag"}>, ctx: RaContext, progress: (message:string)=>void, signal?: AbortSignal): Promise<MetadataReport> {
  const source = await metadataSource(op, ctx);
  const run = await getRun(runId);
  const groundContext = run?.groundContext;
  if (!run) throw new Error("Run not found");
  await checkRunReferences(run, ctx.impUser ?? run.author);
  const identity = createHash("sha256").update(JSON.stringify({ source, groundContext: groundIdentity(groundContext), version: 4 })).digest("hex");
  return withRunLock(`metadata:${runId}:${op.candidateKey}`, async () => {
    const saved = await db().prepare("SELECT identity, report FROM metadata_research WHERE run_id=? AND candidate_key=?").get(runId,op.candidateKey) as {identity:string;report:string}|undefined;
    if (saved?.identity === identity) { progress("Restoring research for this article…"); return JSON.parse(saved.report); }
    const report = await withAiAudit(runId,"metadata",()=>analyzeMetadataSource(source,ctx,progress,signal,groundContext));
    report.identity = identity;
    report.planSourceKey = JSON.stringify({ ...op, metadata: undefined });
    report.groundContext = groundContext;
    report.sources = [{ id: op.kind === "revise" ? op.solutionId : op.candidateKey, title: op.title, body: source.fields?.[0]?.content ?? "" }, ...(op.mergeSources ?? []).map((s, i) => ({ id: s.id, title: s.title, body: source.fields?.[i + 1]?.content ?? "" }))];
    await db().prepare("INSERT INTO metadata_research(run_id,candidate_key,identity,report) VALUES (?,?,?,?) ON CONFLICT(run_id,candidate_key) DO UPDATE SET identity=excluded.identity,report=excluded.report").run(runId,op.candidateKey,identity,JSON.stringify(report));
    return report;
  });
}
