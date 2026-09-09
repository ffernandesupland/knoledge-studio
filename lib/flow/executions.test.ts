import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase, db, useDatabase } from "../db";
import { createRun, completeRun, markSubmitted, failRun } from "../db/runs";
import { freezeExecution, saveWriteState } from "../pipeline/state";
import { saveExecutedFlow, readExecutedFlow, pastExecutions } from "./executions";
import { GET } from "../../app/api/runs/executions/route";
import type { ExecuteArgs } from "../pipeline/execute";

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ks-flow-")); useDatabase(path.join(dir, "test.db"));
  vi.stubEnv("KS_USERS_JSON", JSON.stringify({ alice: { password: "a", raUser: "alice" }, bob: { password: "b", raUser: "bob" } }));
});
afterAll(() => { closeDatabase(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });
const create = (id: string, author = "alice") => createRun({ id, author, path: "create", inputText: "Source", sourceIds: [], operations: [] });
const request = (query: string, user = "alice") => new Request(`http://localhost/api/runs/executions${query}`, { headers: { authorization: `Basic ${Buffer.from(`${user}:${user === "alice" ? "a" : "b"}`).toString("base64")}` } });

describe("saved executed flows", () => {
  it("stores actual prompts and mixed outcomes without inventing enabled calls or successful writes", () => {
    create("mixed"); completeRun("mixed", { candidates: [], groups: [], costUsd: 0.1, steps: [] });
    db().prepare("INSERT INTO ai_calls(run_id,phase,ts,operation,model,input_tokens,output_tokens,cost_usd,prompt_version,request,response) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run("mixed", "submission", "2026-09-09", "compose", "recorded-model", 10, 20, 0.1, "old-version", JSON.stringify({ prompt: "Actual old prompt" }), JSON.stringify({ fields: [] }));
    const plan: ExecuteArgs["plan"] = [0, 1].map((i) => ({ kind: "create", candidateKey: `c${i}`, title: `Topic ${i}`, templateName: "How To", fields: [], idempotencyKey: `mixed:${i}` }));
    freezeExecution("mixed", { runId: "mixed", user: "alice", plan, collection: "KB", language: "English", restructureEnabled: false });
    saveWriteState("mixed", "mixed:0", { status: "ok", result: { kind: "create", idempotencyKey: "mixed:0", description: "Create Topic 0", outcome: "ok", solutionId: "260909000000001" } });
    saveWriteState("mixed", "mixed:1", { status: "review", result: { kind: "create", idempotencyKey: "mixed:1", description: "Create Topic 1", outcome: "review", message: "Needs supported content" } });
    const flow = saveExecutedFlow("mixed");
    expect(readExecutedFlow("mixed")).toEqual(flow);
    const ai = flow.tree.find((n) => n.id === "preparation")!.children!;
    expect(ai).toHaveLength(1); expect(ai[0].detail).toContain("old-version");
    expect(ai[0].record).toEqual({ request: { prompt: "Actual old prompt" }, response: { fields: [] } });
    const writes = flow.tree.find((n) => n.id === "writes")!.children!;
    expect(writes[0].detail).toContain("ok · Solution"); expect(writes[1].detail).toContain("review");
    expect(flow.tree.find((n) => n.id === "analysis")!.children!.filter((n) => n.kind === "ai")).toHaveLength(0);
  });
  it("backfills history, limits it to the authenticated owner, and keeps failed runs readable", async () => {
    create("private", "bob"); failRun("private", "Bob's private failure");
    create("failed"); failRun("failed", "Analysis stopped");
    const list = await GET(request(""));
    const data = await list.json();
    expect(data.runs.map((r: { id: string }) => r.id)).toContain("failed");
    expect(data.runs.map((r: { id: string }) => r.id)).not.toContain("private");
    expect(readExecutedFlow("failed")).toBeDefined();
    expect((await GET(request("?runId=private"))).status).toBe(404);
    expect((await GET(request("?runId=failed"))).status).toBe(200);
    expect((await GET(request("?offset=-1"))).status).toBe(400);
  });
  it("retains a completed saved tree across later reads and paginates history", async () => {
    create("completed"); markSubmitted("completed");
    const saved = saveExecutedFlow("completed");
    expect(await (await GET(request("?runId=completed"))).json()).toEqual(saved);
    for (let i = 0; i < 23; i++) { create(`page-${i}`); failRun(`page-${i}`, "Stopped"); }
    const first = pastExecutions("alice"); const second = pastExecutions("alice", 20);
    expect(first.runs).toHaveLength(20); expect(first.hasMore).toBe(true);
    expect(second.runs.length).toBeGreaterThan(0);
    expect(second.runs.some((r) => first.runs.some((f) => f.id === r.id))).toBe(false);
  });
});
