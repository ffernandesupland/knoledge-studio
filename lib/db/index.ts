import { createClient, type Client, type InArgs, type InValue, type Transaction } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SCHEMA } from "./schema";

let instance: ReturnType<typeof connect> | undefined;

function connect() {
  const remote = process.env.TURSO_DATABASE_URL?.trim();
  if (process.env.VERCEL && !remote) throw new Error("Configure TURSO_DATABASE_URL and TURSO_AUTH_TOKEN before deploying to Vercel.");
  if (remote && !/^(libsql|https):\/\//.test(remote)) throw new Error("TURSO_DATABASE_URL must use libsql:// or https://.");
  if (remote && !process.env.TURSO_AUTH_TOKEN) throw new Error("TURSO_AUTH_TOKEN is required for the remote database.");
  const file = process.env.KS_DB_PATH ?? path.join(process.cwd(), ".data/knowledge-studio.db");
  if (!remote) mkdirSync(path.dirname(file), { recursive: true });
  const client: Client = createClient({ url: remote || pathToFileURL(file).href, authToken: remote ? process.env.TURSO_AUTH_TOKEN : undefined });
  const context = new AsyncLocalStorage<Transaction>();
  // Serialize operations sharing one local connection, including whole transactions.
  // Across serverless instances the database's write transaction provides isolation.
  let tail: Promise<unknown> = Promise.resolve();
  const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
    const pending = tail.then(fn);
    tail = pending.catch(() => undefined);
    return pending;
  };
  let ready: Promise<void> | undefined;
  const initialize = () => ready ??= client.executeMultiple("PRAGMA foreign_keys=ON;\n" + SCHEMA).catch((error) => { ready = undefined; throw error; });
  const execute = (sql: string, values: (InValue | Record<string, InValue>)[]) => {
    const args: InArgs = values.length === 1 && values[0] !== null && typeof values[0] === "object" && !ArrayBuffer.isView(values[0]) && !(values[0] instanceof ArrayBuffer)
      ? values[0] as Record<string, InValue> : values as InValue[];
    const tx = context.getStore();
    if (tx) return tx.execute({ sql, args });
    return enqueue(async () => { await initialize(); return client.execute({ sql, args }); });
  };
  return {
    prepare(sql: string) {
      return {
        async get(...args: (InValue | Record<string, InValue>)[]): Promise<unknown> { return (await execute(sql, args)).rows[0]; },
        async all(...args: (InValue | Record<string, InValue>)[]): Promise<unknown[]> { return (await execute(sql, args)).rows; },
        async run(...args: (InValue | Record<string, InValue>)[]) { const result = await execute(sql, args); return { changes: result.rowsAffected, lastInsertRowid: result.lastInsertRowid }; },
      };
    },
    transaction<T>(fn: () => Promise<T>) {
      return () => enqueue(async () => {
        await initialize();
        const tx = await client.transaction("write");
        try { const result = await context.run(tx, fn); await tx.commit(); return result; }
        catch (error) { await tx.rollback(); throw error; }
        finally { tx.close(); }
      });
    },
    close() { client.close(); },
  };
}

export function db() { return instance ??= connect(); }
export function closeDatabase() { instance?.close(); instance = undefined; }
/** Test-only local database selection; never changes the remote configuration. */
export function useDatabase(file: string) { closeDatabase(); process.env.KS_DB_PATH = file; }
