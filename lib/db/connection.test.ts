import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { db, closeDatabase, useDatabase } from "./index";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "ks-connection-"));
  vi.stubEnv("TURSO_DATABASE_URL", "");
  vi.stubEnv("VERCEL", "");
  useDatabase(path.join(dir, "test.db"));
});
afterEach(() => { closeDatabase(); vi.unstubAllEnvs(); rmSync(dir, { recursive: true, force: true }); });

describe("persistent database connection", () => {
  it("rolls back all writes and allows later work after an error", async () => {
    await expect(db().transaction(async () => {
      await db().prepare("INSERT INTO run_locks VALUES (?,?,?)").run("rollback", "owner", 1);
      throw new Error("interrupted");
    })()).rejects.toThrow("interrupted");
    expect(await db().prepare("SELECT * FROM run_locks").all()).toEqual([]);
    await db().prepare("INSERT INTO run_locks VALUES (?,?,?)").run("saved", "owner", 1);
    closeDatabase();
    expect(await db().prepare("SELECT token FROM run_locks WHERE run_id=?").get("saved")).toEqual({ token: "owner" });
  });
  it("isolates a concurrent query from an uncommitted transaction", async () => {
    let inserted!: () => void;
    const started = new Promise<void>((resolve) => { inserted = resolve; });
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const tx = db().transaction(async () => {
      await db().prepare("INSERT INTO run_locks VALUES (?,?,?)").run("private", "owner", 1);
      inserted();
      await gate;
      throw new Error("rollback");
    })();
    const failed = expect(tx).rejects.toThrow("rollback");
    await started;
    const outside = db().prepare("SELECT * FROM run_locks").all();
    release();
    await failed;
    expect(await outside).toEqual([]);
  });
  it("refuses ephemeral local storage on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    expect(() => db()).toThrow("Configure TURSO_DATABASE_URL");
  });
});
