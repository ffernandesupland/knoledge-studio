import { config } from "../config";
import { parseJson, raFetch } from "./http";

interface LoginResponse {
  jwtoken: string;
}

interface CachedToken {
  token: string;
  /** Epoch millis from the JWT `exp` claim. */
  expiresAt: number;
}

/** QA tenant issues 15-minute tokens, so refresh well ahead of expiry. */
const REFRESH_MARGIN_MS = 90_000;

const cache = new Map<string, CachedToken>();
const inFlight = new Map<string, Promise<string>>();

function decodeExp(jwt: string): number {
  const part = jwt.split(".")[1];
  if (!part) return Date.now() + 10 * 60_000;
  const json = Buffer.from(part.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  const claims = JSON.parse(json) as { exp?: number };
  return claims.exp ? claims.exp * 1000 : Date.now() + 10 * 60_000;
}

function basicHeader(): string {
  return `Basic ${Buffer.from(`${config.ra.username}:${config.ra.password}`).toString("base64")}`;
}

async function login(impUser?: string): Promise<string> {
  const { text } = await raFetch(config.ra.baseUrl, {
    path: "/api/rest/login",
    query: {
      companyCode: config.ra.companyCode,
      appInterface: config.ra.appInterface,
      imp_user: impUser,
    },
    headers: { Authorization: basicHeader() },
    timeoutMs: config.ra.timeoutMs,
  });
  const parsed = parseJson<LoginResponse>(text, "/api/rest/login");
  if (!parsed.jwtoken) throw new Error("Login succeeded but returned no jwtoken");
  return parsed.jwtoken;
}

/**
 * Returns a valid JWT for the given impersonated user, reusing the cached token when it
 * still has headroom. Concurrent callers share one login rather than stampeding.
 */
export async function getToken(impUser?: string): Promise<string> {
  const key = `${config.ra.companyCode}|${config.ra.appInterface}|${impUser ?? ""}`;
  const hit = cache.get(key);
  if (hit && hit.expiresAt - REFRESH_MARGIN_MS > Date.now()) return hit.token;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const p = (async () => {
    try {
      const token = await login(impUser);
      cache.set(key, { token, expiresAt: decodeExp(token) });
      return token;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, p);
  return p;
}

export function clearTokenCache(): void {
  cache.clear();
}

export function tokenTtlSeconds(jwt: string): number {
  return Math.round((decodeExp(jwt) - Date.now()) / 1000);
}
