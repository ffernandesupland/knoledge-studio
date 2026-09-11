import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase, db, useDatabase } from "../db";
import { enqueue, claim, getJob, assertLease, events, eventDetail, event, finish, assertGuided } from "./store";
import { tracked, withAutonomousContext } from "./telemetry";
import { completeRun, createRun, discardResumableRun, getResumableRun, getRun } from "../db/runs";
import { POST, GET } from "../../app/api/autonomous/route";
import { GET as readEvents } from "../../app/api/autonomous/events/route";
import { raFetch } from "../ra/http";

let dir: string, id: string, count = 0;
const input = { text: "Verified source material", operations: [], standardsRules: [] };
beforeAll(() => { dir = mkdtempSync(path.join(tmpdir(), "ks-auto-store-")); useDatabase(path.join(dir, "test.db")); });
afterAll(() => { closeDatabase(); rmSync(dir, { recursive: true, force: true }); });
beforeEach(async () => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals();
  id = `auto-store-${++count}`;
  await db().prepare("UPDATE autonomous_jobs SET status='failed' WHERE status IN ('running','queued')").run();
  for (const key of ["KS_AUTH_USERNAME", "KS_AUTH_PASSWORD", "AUTH_SECRET", "KS_USERS_JSON"]) vi.stubEnv(key, "");
  vi.stubEnv("KS_PILOT_AUTHOR", "sauser");
});
const req = (body: unknown) => new Request("http://localhost/api/autonomous", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
describe("isolated autonomous queue and API", () => {
  it("records authorization and makes enqueue idempotent without allowing another actor or changed input", async () => {
    await enqueue(id, "sauser", input); await enqueue(id, "sauser", input);
    expect((await events(id))).toHaveLength(1);
    expect((await getJob(id))?.authorization).toMatchObject({ actor: "sauser", scope: "create-review-drafts-and-revisions" });
    await expect(enqueue(id, "someone", input)).rejects.toThrow("already used");
    await expect(enqueue(id, "sauser", { ...input, text: "changed" })).rejects.toThrow("already used");
  });
  it("grants one lease, recovers after expiry and fences the previous worker", async () => {
    await enqueue(id, "sauser", input);
    const claims = await Promise.all([claim(), claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    const first = claims.find(Boolean)!;
    await db().prepare("UPDATE autonomous_jobs SET lease_until=0 WHERE run_id=?").run(id);
    const second = (await claim())!;
    expect(first.token).not.toBe(second.token);
    await expect(assertLease(id, first.token)).rejects.toThrow("lease lost");
    await expect(finish(id, first.token, "failed")).rejects.toThrow("lease lost");
    expect((await getJob(id))?.status).toBe("running");
    await finish(id, second.token, "completed");
    expect(await claim()).toBeUndefined();
    expect((await getRun(id))?.status).toBe("submitted");
  });
  it("does not restore or discard autonomous records through the guided wizard", async () => {
    const view = { candidates: [], groups: [], costUsd: 0, steps: [] };
    await createRun({ id: `${id}-guided`, author: "sauser", path: "create", inputText: "input", sourceIds: [], operations: [] });
    await completeRun(`${id}-guided`, view);
    await enqueue(id, "sauser", input); await completeRun(id, view);
    expect((await getResumableRun("sauser"))?.id).toBe(`${id}-guided`);
    await expect(assertGuided(id)).rejects.toThrow("controlled by their autonomous execution");
    await expect(assertGuided(`${id}-guided`)).resolves.toBeUndefined();
    await discardResumableRun("sauser");
    expect((await getRun(id))?.status).toBe("done");
    expect((await getRun(`${id}-guided`))?.status).toBe("discarded");
  });
  it("requires per-run opt-in and starts without environment setup or a worker", async () => {
    const body = { requestId: crypto.randomUUID(), autonomous: true, input };
    expect((await POST(req({ ...body, autonomous: false }))).status).toBe(400);
    const response = await POST(req(body)); expect(response.status).toBe(202);
    const job = await response.json();
    expect((await POST(req(body))).status).toBe(202);
    expect((await getJob(job.runId))?.status).toBe("queued");
    expect((await POST(req({ ...body, requestId: crypto.randomUUID(), input: { ...input, text: "" } }))).status).toBe(400);
  });
  it("enforces ownership on status and event reads, and paginates without copying full payloads", async () => {
    await enqueue(id, "someone-else", input);
    expect((await GET(new Request(`http://localhost/api/autonomous?runId=${id}`))).status).toBe(404);
    expect((await readEvents(new Request(`http://localhost/api/autonomous/events?runId=${id}`))).status).toBe(404);
    await enqueue(`${id}-own`, "sauser", input);
    for (let n = 0; n < 102; n++) await event(`${id}-own`, "analysis", "model", `call ${n}`, "started", { input: { prompt: "long source" } });
    const first = await (await readEvents(new Request(`http://localhost/api/autonomous/events?runId=${id}-own`))).json();
    expect(first.events).toHaveLength(100); expect(first.hasMore).toBe(true); expect(first.events[1].input).toBeUndefined();
    const detail = await eventDetail(`${id}-own`, first.events[1].id); expect(detail?.input).toEqual({ prompt: "long source" });
    const second = await events(`${id}-own`, first.events.at(-1).id); expect(second).toHaveLength(3);
    expect(await eventDetail(id, first.events[1].id)).toBeUndefined();
  });
  it("caches resumed analysis reads, never caches submission, and leaves guided calls untouched", async () => {
    await enqueue(id, "sauser", input); const job = (await claim())!;
    const call = vi.fn(async () => ({ items: [1] }));
    await withAutonomousContext(id, job.token, "analysis", async () => { await tracked("tool", "search", {}, call, true); await tracked("tool", "search", {}, call, true); });
    expect(call).toHaveBeenCalledTimes(1);
    await withAutonomousContext(id, job.token, "submission", async () => { await tracked("tool", "search", {}, call, true); await tracked("tool", "search", {}, call, true); });
    expect(call).toHaveBeenCalledTimes(3);
    const before = (await events(id)).length;
    await tracked("tool", "search", {}, call, true);
    expect((await events(id))).toHaveLength(before);
    expect(call).toHaveBeenCalledTimes(4);
  });
  it("logs authentication status without persisting JWTs or authorization headers", async () => {
    await enqueue(id, "sauser", input); const job = (await claim())!;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response('{"jwtoken":"secret-jwt"}')));
    const result = await withAutonomousContext(id, job.token, "analysis", () => raFetch("https://example.test", { path: "/api/rest/login", headers: { Authorization: "secret-password" } }));
    expect(result.text).toContain("secret-jwt");
    const log = JSON.stringify(await events(id));
    expect(log).not.toContain("secret-jwt"); expect(log).not.toContain("secret-password"); expect(log).toContain("Authentication response omitted");
  });
});
