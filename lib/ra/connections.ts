import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "../db";
import { ApiError } from "../api/auth";

export const ENV_CONNECTION_ID = "environment";

export interface RaConnectionSummary {
  id: string;
  name: string;
  baseUrl: string;
  user: string;
  companyCode: string;
  isDefault: boolean;
  managedByEnvironment?: boolean;
}

export interface RaRuntimeConnection {
  id: string;
  baseUrl?: string;
  bearerToken?: string;
  user?: string;
  companyCode?: string;
}

type Row = { id: string; owner: string; name: string; base_url: string; bearer_token: string; ra_user: string };

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to protect saved RightAnswers tokens.");
  return createHash("sha256").update(secret).digest();
}

function encrypt(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(value: string) {
  const [version, iv, tag, encrypted] = value.split(".");
  if (version !== "v1" || !iv || !tag || !encrypted) throw new Error("Saved RightAnswers token is invalid.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(encrypted, "base64url")), decipher.final()]).toString("utf8");
}

export const normalizeToken = (value: string) => value.trim().replace(/^Bearer\s+/i, "");

export function normalizeBaseUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) {
    throw new ApiError("RightAnswers URL must use HTTPS.");
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/+$/, "");
}

async function defaultId(owner: string) {
  const row = await db().prepare("SELECT connection_id FROM ra_connection_defaults WHERE owner=?").get(owner) as { connection_id: string } | undefined;
  return row?.connection_id ?? ENV_CONNECTION_ID;
}

export async function listConnections(owner: string): Promise<RaConnectionSummary[]> {
  const selected = await defaultId(owner);
  const rows = await db().prepare("SELECT c.*, COALESCE(s.company_code,'') AS company_code FROM ra_connections c LEFT JOIN ra_connection_settings s ON s.connection_id=c.id WHERE c.owner=? ORDER BY c.name COLLATE NOCASE").all(owner) as (Row & { company_code: string })[];
  return [
    { id: ENV_CONNECTION_ID, name: "Environment default", baseUrl: process.env.RA_BASE_URL?.replace(/\/+$/, "") ?? "Not configured", user: process.env.RA_USERNAME ?? owner, companyCode: process.env.RA_COMPANY_CODE ?? "", isDefault: selected === ENV_CONNECTION_ID, managedByEnvironment: true },
    ...rows.map(row => ({ id: row.id, name: row.name, baseUrl: row.base_url, user: row.ra_user, companyCode: row.company_code, isDefault: selected === row.id })),
  ];
}

export async function resolveConnection(owner: string, requestedId?: string | null): Promise<RaRuntimeConnection> {
  const id = requestedId || await defaultId(owner);
  if (id === ENV_CONNECTION_ID) return { id };
  const row = await db().prepare("SELECT c.*, COALESCE(s.company_code,'') AS company_code FROM ra_connections c LEFT JOIN ra_connection_settings s ON s.connection_id=c.id WHERE c.id=? AND c.owner=?").get(id, owner) as (Row & { company_code: string }) | undefined;
  if (!row) throw new ApiError("RightAnswers connection not found.", 404);
  return { id: row.id, baseUrl: row.base_url, bearerToken: decrypt(row.bearer_token), user: row.ra_user, companyCode: row.company_code };
}

export async function createConnection(owner: string, input: { name: string; baseUrl: string; bearerToken: string; user: string; companyCode: string }) {
  const id = randomUUID();
  const ts = new Date().toISOString();
  try {
    await db().transaction(async () => {
      await db().prepare("INSERT INTO ra_connections(id,owner,name,base_url,bearer_token,ra_user,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)")
        .run(id, owner, input.name.trim(), normalizeBaseUrl(input.baseUrl), encrypt(normalizeToken(input.bearerToken)), input.user.trim(), ts, ts);
      await db().prepare("INSERT INTO ra_connection_settings(connection_id,company_code) VALUES(?,?)").run(id, input.companyCode.trim());
    })();
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new ApiError("A customer with this name already exists.", 409);
    throw error;
  }
  return id;
}

export async function updateConnection(owner: string, id: string, input: { name: string; baseUrl: string; bearerToken?: string; user: string; companyCode: string }) {
  if (id === ENV_CONNECTION_ID) throw new ApiError("Environment settings are managed outside Knowledge Studio.");
  const row = await db().prepare("SELECT * FROM ra_connections WHERE id=? AND owner=?").get(id, owner) as Row | undefined;
  if (!row) throw new ApiError("RightAnswers connection not found.", 404);
  const nextUrl = normalizeBaseUrl(input.baseUrl);
  const activeRun = await db().prepare("SELECT 1 FROM run_ra_connections rc JOIN runs r ON r.id=rc.run_id WHERE rc.connection_id=? AND r.status IN ('running','done','partial') LIMIT 1").get(id);
  const current = await resolveConnection(owner, id);
  if (activeRun && (row.base_url !== nextUrl || row.ra_user !== input.user.trim() || (!!current.companyCode && current.companyCode !== input.companyCode.trim()))) {
    throw new ApiError("Finish or discard the active run before changing this customer's URL, company code, or user. You can still refresh its credential.", 409);
  }
  const token = input.bearerToken?.trim() ? normalizeToken(input.bearerToken) : current.bearerToken!;
  let changes = 0;
  await db().transaction(async () => {
    const result = await db().prepare("UPDATE ra_connections SET name=?,base_url=?,bearer_token=?,ra_user=?,updated_at=? WHERE id=? AND owner=?")
      .run(input.name.trim(), nextUrl, encrypt(token), input.user.trim(), new Date().toISOString(), id, owner);
    changes = result.changes;
    await db().prepare("INSERT INTO ra_connection_settings(connection_id,company_code) VALUES(?,?) ON CONFLICT(connection_id) DO UPDATE SET company_code=excluded.company_code").run(id, input.companyCode.trim());
  })();
  if (!changes) throw new ApiError("RightAnswers connection not found.", 404);
}

export async function setDefaultConnection(owner: string, id: string) {
  await resolveConnection(owner, id);
  await db().prepare("INSERT INTO ra_connection_defaults(owner,connection_id) VALUES(?,?) ON CONFLICT(owner) DO UPDATE SET connection_id=excluded.connection_id").run(owner, id);
}

export async function deleteConnection(owner: string, id: string) {
  if (id === ENV_CONNECTION_ID) throw new ApiError("The environment connection cannot be deleted.");
  const used = await db().prepare("SELECT 1 FROM run_ra_connections rc JOIN runs r ON r.id=rc.run_id WHERE rc.connection_id=? AND r.status IN ('running','done','partial') LIMIT 1").get(id);
  if (used) throw new ApiError("This connection belongs to an active run and cannot be deleted.", 409);
  const result = await db().prepare("DELETE FROM ra_connections WHERE id=? AND owner=?").run(id, owner);
  if (!result.changes) throw new ApiError("RightAnswers connection not found.", 404);
  await db().prepare("DELETE FROM ra_connection_defaults WHERE owner=? AND connection_id=?").run(owner, id);
}

export async function saveRunConnection(runId: string, connectionId: string) {
  await db().prepare("INSERT INTO run_ra_connections(run_id,connection_id) VALUES(?,?) ON CONFLICT(run_id) DO UPDATE SET connection_id=excluded.connection_id").run(runId, connectionId);
}

export async function runConnection(owner: string, runId: string) {
  const row = await db().prepare("SELECT connection_id FROM run_ra_connections WHERE run_id=?").get(runId) as { connection_id: string } | undefined;
  return resolveConnection(owner, row?.connection_id ?? ENV_CONNECTION_ID);
}
