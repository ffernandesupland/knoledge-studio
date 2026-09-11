import { ra, withRaActor } from "../ra/client";
import { runPipeline } from "../pipeline/run";
import { mapRunToView } from "../ks/model";
import { completeRun, getRun, saveSnapshot, type DecisionSnapshot } from "../db/runs";
import { withAiAudit } from "../llm/audit";
import { db } from "../db";
import { buildWritePlan, describeOp, type WriteOp } from "../pipeline/submit";
import { executeWritePlan, type ExecuteArgs, type OpResult } from "../pipeline/execute";
import { executionResults, freezePreparedPlan, getWriteState, savePreparationPlan, saveWriteState, withRunLock } from "../pipeline/state";
import { submissionIdentity } from "../ks/submission-plan";
import { saveExecutedFlow } from "../flow/executions";
import { decide, decisionSnapshot, reviewDraft, validateQuality, type Catalog, type QualityDecision } from "./decisions";
import { assertLease, checkpoint, event, finish, saveCheckpoint, stage } from "./store";
import { withAutonomousContext } from "./telemetry";
import { AUTONOMOUS_POLICY_VERSION, type AutonomousJob, type AutonomousStage } from "./types";

export async function processJob(job: AutonomousJob, token: string, singleStep = false) {
  const id = job.runId;
  let currentStage = job.stage;
  async function within<T>(name: AutonomousStage, fn: () => Promise<T>): Promise<T> {
    await stage(id, token, name);
    currentStage = name;
    return withAutonomousContext(id, token, name, () => withRaActor(job.author, () => withAiAudit(id, name === "analysis" ? "analysis" : `autonomous:${name}`, fn)));
  }
  // Existing write locks and journals remain authoritative for side effects.
  await withRunLock(id, async () => {
    try {
      if (job.authorization.actor !== job.author || job.authorization.scope !== "create-review-drafts-and-revisions" || job.authorization.policyVersion !== AUTONOMOUS_POLICY_VERSION) throw new Error("Autonomous authorization is invalid or obsolete");
      await assertLease(id, token);
      if (!await checkpoint(id, "analysis-complete")) {
        await within("analysis", async () => {
          await event(id, "analysis", "state", "Gathering evidence and building proposals", "started");
          const pending: Promise<unknown>[] = [];
          let logError: unknown;
          const output = await runPipeline(job.input, p => { pending.push(event(id, "analysis", "state", p.step, p.status === "start" ? "started" : "succeeded").catch(e => { logError = e; })); });
          await Promise.all(pending);
          if (logError) throw logError;
          await assertLease(id, token);
          await completeRun(id, mapRunToView(output));
          await saveCheckpoint(id, "analysis-complete", true);
        });
        if (singleStep) return;
      }
      let snapshot = await checkpoint<DecisionSnapshot>(id, "decisions");
      if (!snapshot) {
        snapshot = await within("decisions", async () => {
          const run = (await getRun(id))!;
          // Use the same facet request as the guided Metadata screen. RA rejects
          // the languages-only request on the pilot server with HTTP 500.
          const [templates, collections, facets] = await Promise.all([ra.getTemplates(), ra.getCollections(), ra.search({ returnTypes: "taxonomies,languages", page: 1 })]);
          const catalog: Catalog = { templates, collections, languages: facets.languages ?? [] };
          if (!templates.length || !collections.length || !catalog.languages.length) throw new Error("The catalog does not contain the required templates, collections and languages");
          const result = await decide(run, job.input, catalog);
          const value = decisionSnapshot(run, job.input, catalog, result.data);
          for (const d of result.data.candidates) await event(id, "decisions", "decision", `Proposal ${d.key}: ${d.keep ? "include" : "skip"}`, d.keep ? "succeeded" : "skipped", { explanation: d.explanation, output: d });
          for (const d of result.data.groups) await event(id, "decisions", "decision", `Group ${d.index}: ${d.decision}`, "succeeded", { explanation: d.explanation, output: d });
          await event(id, "decisions", "decision", "Choose final metadata", "succeeded", { explanation: result.data.metadata.explanation, output: result.data.metadata });
          await saveSnapshot(id, value);
          await saveCheckpoint(id, "decisions", value);
          return value;
        });
        if (singleStep) return;
      }
      const plan = buildWritePlan({ runId: id, candidates: snapshot.candidates, groups: snapshot.groups, selected: new Set(snapshot.selectedKeys), resolutions: snapshot.resolutions });
      const args: ExecuteArgs = { runId: id, user: job.author, plan, collection: snapshot.collection, language: snapshot.language, stage: "preparation", reviewIdentity: submissionIdentity(plan, snapshot), restructureEnabled: job.input.operations.includes("Restructure content"), standardsRules: job.input.operations.includes("Apply content standards") ? job.input.standardsRules : [] };
      await savePreparationPlan(id, args);
      if (!plan.length) {
        await finish(id, token, "partial", "The agent found no source-supported articles to submit. See the recorded proposal decisions.");
        return;
      }
      for (const op of plan.filter(op => op.kind !== "flag")) {
        if (await checkpoint(id, `review-complete:${op.idempotencyKey}`)) continue;
        try {
          if (!await checkpoint(id, `prepared:${op.idempotencyKey}`)) {
            await within("preparation", async () => {
              await event(id, "preparation", "state", describeOp(op), "started");
              await executeWritePlan({ ...args, plan: [op], prepareOnly: true });
            });
            await saveCheckpoint(id, `prepared:${op.idempotencyKey}`, true);
            if (singleStep) return;
          }
          await within("review", async () => {
            // Each correction must be revalidated AND reviewed as a new version before writing.
            for (let attempt = 0; attempt < 3; attempt++) {
              const state = await getWriteState(op.idempotencyKey);
              if (!state?.prepared || ["ok", "uncertain", "writing"].includes(state.status)) break;
              const prepared = state.prepared;
              const reviewKey = `quality:${op.idempotencyKey}:${prepared.version}`;
              let decision = await checkpoint<QualityDecision>(id, reviewKey);
              if (!decision) {
                const roundsKey = `quality-rounds:${op.idempotencyKey}`;
                const rounds = await checkpoint<number>(id, roundsKey) ?? 0;
                if (rounds >= 3) throw new Error("The saved limit of three quality-review rounds was reached. No write attempted.");
                await saveCheckpoint(id, roundsKey, rounds + 1);
                decision = (await reviewDraft(prepared, prepared.readyForSubmission ? undefined : state.result?.message)).data;
                validateQuality(prepared, decision);
                await event(id, "review", "decision", `${decision.verdict}: ${prepared.title}`, decision.verdict === "skip" ? "skipped" : "succeeded", { explanation: decision.explanation, input: { preparedVersion: prepared.version }, output: decision });
                await saveCheckpoint(id, reviewKey, decision);
              }
              if (decision.verdict === "accept" && prepared.readyForSubmission) {
                await saveCheckpoint(id, `approved:${op.idempotencyKey}`, { actor: "agent", version: prepared.version, policyVersion: AUTONOMOUS_POLICY_VERSION, explanation: decision.explanation, evidence: decision.evidence });
                break;
              }
              if (decision.verdict !== "revise" || attempt === 2) {
                await saveWriteState(id, op.idempotencyKey, { status: "review", prepared: { ...prepared, readyForSubmission: false }, result: { kind: op.kind, idempotencyKey: op.idempotencyKey, description: describeOp(op), outcome: "review", prepared: { ...prepared, readyForSubmission: false }, message: decision.explanation } });
                break;
              }
              await executeWritePlan({ ...args, plan: [op], prepareOnly: true, reviews: { [op.idempotencyKey]: { version: prepared.version, title: decision.title, summary: decision.summary, keywords: decision.keywords, fields: decision.fields } } });
              if (singleStep) return;
            }
            await saveCheckpoint(id, `review-complete:${op.idempotencyKey}`, true);
          });
          if (singleStep) return;
        } catch (error) {
          await assertLease(id, token);
          const message = error instanceof Error ? error.message : String(error);
          await event(id, currentStage, "error", `Could not prepare or approve: ${describeOp(op)}`, "failed", { explanation: message });
          const saved = await getWriteState(op.idempotencyKey);
          if (!["ok", "writing", "uncertain"].includes(saved?.status ?? "")) await saveWriteState(id, op.idempotencyKey, { status: "review", prepared: saved?.prepared, result: { kind: op.kind, idempotencyKey: op.idempotencyKey, description: describeOp(op), outcome: "review", prepared: saved?.prepared, message } });
          await saveCheckpoint(id, `review-complete:${op.idempotencyKey}`, true);
        }
      }
      await assertLease(id, token);
      await freezePreparedPlan(id, args);
      const submissionComplete = await within("submission", async () => {
        for (const op of plan) {
          await assertLease(id, token);
          const state = await getWriteState(op.idempotencyKey);
          if (state?.status === "ok" || await checkpoint(id, `write-attempted:${op.idempotencyKey}`)) continue;
          if (op.kind === "flag") {
            const survivor = plan.find(p => p.kind !== "flag" && p.candidateKey === op.survivorKey);
            if (!survivor || (await getWriteState(survivor.idempotencyKey))?.status !== "ok") {
              const result: OpResult = { kind: "flag", idempotencyKey: op.idempotencyKey, description: describeOp(op), outcome: "skipped", message: "Destination was not successfully written; no tracking comment was added." };
              await saveWriteState(id, op.idempotencyKey, { status: "error", result });
              await event(id, "submission", "write", result.description, "skipped", { output: result });
              continue;
            }
            await write([survivor, op], {});
          } else {
            const approval = await checkpoint<{ actor: string; version: string; policyVersion: string }>(id, `approved:${op.idempotencyKey}`);
            if (!approval || approval.actor !== "agent" || approval.policyVersion !== AUTONOMOUS_POLICY_VERSION || approval.version !== state?.prepared?.version || !state.prepared.readyForSubmission) {
              await event(id, "submission", "write", describeOp(op), "skipped", { explanation: "No valid agent quality approval for this exact prepared version. No write attempted." });
              continue;
            }
            await write([op], { [op.idempotencyKey]: approval.version });
          }
          await saveCheckpoint(id, `write-attempted:${op.idempotencyKey}`, true);
          if (singleStep) return false;
        }
        return true;
        async function write(ops: WriteOp[], approvals: Record<string, string>) {
          const results = await executeWritePlan({ ...args, stage: "submission", plan: ops, requirePrepared: true, approvals });
          for (const r of results) await event(id, "submission", "write", r.description, r.outcome === "ok" ? "succeeded" : r.outcome === "skipped" ? "skipped" : "failed", { output: r });
        }
      });
      if (!submissionComplete) return;
      const results = await executionResults(id);
      const allWritten = plan.every(p => results.some(r => r.idempotencyKey === p.idempotencyKey && r.outcome === "ok"));
      await finish(id, token, allWritten ? "completed" : "partial", allWritten ? undefined : "Some items could not be submitted. Completed writes are saved; inspect the diagram and decision log for unresolved items.");
    } catch (error) {
      await assertLease(id, token); // A stale request cannot overwrite its successor's state.
      const message = error instanceof Error ? error.message : String(error);
      await event(id, currentStage, "error", "Execution stopped", "failed", { explanation: message });
      const results = await executionResults(id);
      await finish(id, token, results.some(r => r.outcome === "ok") ? "partial" : "failed", message);
    } finally {
      // Charged calls from interrupted/replayed attempts are also included in the total.
      await db().prepare("UPDATE runs SET cost_usd=COALESCE((SELECT SUM(cost_usd) FROM ai_calls WHERE run_id=?),0) WHERE id=?").run(id, id);
      await saveExecutedFlow(id);
    }
  }, singleStep ? 60_000 : undefined);
}
