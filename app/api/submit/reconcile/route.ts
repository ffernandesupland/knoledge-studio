import { saveExecutedFlow } from "@/lib/flow/executions";
import { randomUUID } from "node:crypto";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import { requireActor, apiError } from "@/lib/api/auth";
import { assertOwner, readJson } from "@/lib/api/validation";
import { getRun } from "@/lib/db/runs";
import { ra } from "@/lib/ra/client";
import { getWriteState, loadExecution, saveWriteState, withRunLock } from "@/lib/pipeline/state";
import type { ExecuteArgs, OpResult } from "@/lib/pipeline/execute";
import { describeOp } from "@/lib/pipeline/submit";
import { recordAudit } from "@/lib/pipeline/audit";
import { runConnection } from "@/lib/ra/connections";
import { withRaConnection } from "@/lib/ra/client";

const schema = z.object({ runId: z.string().max(100), key: z.string().max(200), action: z.enum(["confirm", "retry"]), solutionId: z.string().regex(/^\d{15}$/).optional(), verified: z.literal(true) });
const normalized = (s: string) => sanitizeHtml(s, { allowedTags: [], allowedAttributes: {} }).replace(/\s+/g, " ").trim();
export async function POST(request: Request) {
  try {
    const user = await requireActor(request);
    const body = await readJson(request, schema);
    const run = (await getRun(body.runId));
    assertOwner(run, user);
    const connection = await runConnection(user, run.id);
    return await withRaConnection(user, connection, () => withRunLock(run.id, async () => {
      const state = (await getWriteState(body.key));
      const op = (await loadExecution<ExecuteArgs>(run.id))?.plan.find((p) => p.idempotencyKey === body.key);
      if (!op || !state || !["writing", "uncertain"].includes(state.status)) throw new Error("No uncertain write to reconcile");
      if (body.action === "retry") {
        (await recordAudit({ ts: new Date().toISOString(), runId: run.id, user, op: "reconcile-retry", idempotencyKey: `${body.key}:verified-absent:${randomUUID()}`, request: body, outcome: "ok", response: "Author explicitly verified that the write did not occur" }));
        (await saveWriteState(run.id, body.key, { status: "error", prepared: state.prepared }));
        (await saveExecutedFlow(run.id));
        return Response.json({ ok: true });
      }
      if (op.kind !== "flag") {
        if (!body.solutionId || !state.prepared) throw new Error("Enter the actual RightAnswers draft/revision ID");
        const actual = await ra.getSolutionHtml(body.solutionId, { impUser: user });
        const content = state.prepared;
        if (actual.templateName !== content.templateName || normalized(actual.title) !== normalized(content.title) || content.fields.some((f) => normalized(actual.fields?.find((a) => a.name === f.fieldName)?.content ?? "") !== normalized(f.fieldValue))) throw new Error("The supplied article does not match the prepared content. Verify the ID and retry reconciliation.");
        if (op.kind === "revise" && actual.id !== op.solutionId && actual.revisionID !== `parent${op.solutionId}`) throw new Error("This revision does not belong to the expected parent article");
      }
      const target = op.kind === "flag" ? op.solutionId : body.solutionId;
      const result: OpResult = { idempotencyKey: body.key, kind: op.kind, description: describeOp(op), outcome: "ok", solutionId: target, title: state.prepared?.title, fields: state.prepared?.fields, prepared: state.prepared, message: "Verified after an uncertain response" };
      (await recordAudit({ ts: new Date().toISOString(), runId: run.id, user, op: op.kind, idempotencyKey: body.key, target, request: { reconciliation: body, prepared: state.prepared }, outcome: "ok", response: "Author verification; article content checked against RA when applicable" }));
      (await saveWriteState(run.id, body.key, { status: "ok", prepared: state.prepared, result }));
      (await saveExecutedFlow(run.id));
      return Response.json({ ok: true, result });
    }));
  } catch (e) { return apiError(e); }
}
