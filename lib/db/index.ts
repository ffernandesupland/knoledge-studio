import { createClient, type Client, type InArgs, type InValue, type Transaction } from "@libsql/client";
import { AsyncLocalStorage } from "node:async_hooks";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { SCHEMA } from "./schema";
import { AGENT_SCHEMA } from "../agent/schema";

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
  const initialize = () => ready ??= (async () => {
    await client.executeMultiple("PRAGMA foreign_keys=ON;\n" + SCHEMA + AGENT_SCHEMA);
    // SQLite cannot add a column through CREATE TABLE IF NOT EXISTS. Keep old
    // local databases readable while profiles move to multi-value scopes.
    const columns = await client.execute("PRAGMA table_info(configuration_profiles)");
    const names = new Set(columns.rows.map(row => String(row.name)));
    if (!names.has("scope_collections")) await client.execute("ALTER TABLE configuration_profiles ADD COLUMN scope_collections TEXT");
    if (!names.has("scope_taxonomies")) await client.execute("ALTER TABLE configuration_profiles ADD COLUMN scope_taxonomies TEXT");
    if (!names.has("scope_operator")) await client.execute("ALTER TABLE configuration_profiles ADD COLUMN scope_operator TEXT NOT NULL DEFAULT 'and'");
    await client.execute("UPDATE configuration_profiles SET scope_collections=CASE WHEN scope_collections IS NULL THEN CASE WHEN scope_collection IS NULL THEN '[]' ELSE json_array(scope_collection) END ELSE scope_collections END, scope_taxonomies=CASE WHEN scope_taxonomies IS NULL THEN CASE WHEN scope_taxonomy IS NULL THEN '[]' ELSE json_array(scope_taxonomy) END ELSE scope_taxonomies END, scope_operator=COALESCE(scope_operator, 'and')");
    await client.execute("DROP INDEX IF EXISTS idx_configuration_profiles_scope");
    await client.execute("CREATE UNIQUE INDEX IF NOT EXISTS idx_configuration_profiles_scope_v2 ON configuration_profiles(connection_id, kind, COALESCE(scope_collections, '[]'), COALESCE(scope_taxonomies, '[]'), scope_operator) WHERE status = 'active' AND is_default = 0");
  })().catch((error) => { ready = undefined; throw error; });
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
