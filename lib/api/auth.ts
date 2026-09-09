import { credentialVersion, loginActor, loginConfigured } from "../auth/credentials";
import { getToken } from "next-auth/jwt";
import { timingSafeEqual } from "node:crypto";

export class ApiError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
const equal = (a: string, b: string) => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

/** Local pilot in development; shared deployments require configured named accounts. */
export async function requireActor(request: Request): Promise<string> {
  const requestUrl = new URL(request.url);
  // Next may normalize Request.url to localhost; Host preserves the browser origin.
  const publicOrigin = process.env.KS_PUBLIC_ORIGIN?.replace(/\/$/, "") || `${process.env.VERCEL === "1" ? "https:" : requestUrl.protocol}//${request.headers.get("host") ?? requestUrl.host}`;
  const origin = request.headers.get("origin");
  if (origin && origin !== publicOrigin) throw new ApiError("Cross-origin requests are not allowed", 403);
  if (process.env.KS_AUTH_USERNAME || process.env.KS_AUTH_PASSWORD || process.env.AUTH_SECRET) {
    if (!loginConfigured()) throw new ApiError("Configure KS_AUTH_USERNAME, KS_AUTH_PASSWORD and a 32-character AUTH_SECRET", 503);
    const token = await getToken({ req: request, secret: process.env.AUTH_SECRET!, secureCookie: new URL(publicOrigin).protocol === "https:" });
    if (!token || token.credentialVersion !== credentialVersion() || token.sub !== loginActor()) throw new ApiError("Sign in to Knowledge Studio", 401);
    return token.sub;
  }
  const configured = process.env.KS_USERS_JSON;
  if (!configured) {
    const host = new URL(publicOrigin).hostname;
    if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(host)) return process.env.KS_PILOT_AUTHOR ?? "sauser";
    throw new ApiError("Configure KS_USERS_JSON before shared or production use.", 503);
  }
  let users: Record<string, { password: string; raUser: string }>;
  try { users = JSON.parse(configured); } catch { throw new ApiError("KS_USERS_JSON configuration is invalid", 503); }
  if (!users || typeof users !== "object" || Array.isArray(users)) throw new ApiError("KS_USERS_JSON configuration is invalid", 503);
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Basic ")) throw new ApiError("Sign in to Knowledge Studio", 401);
  const credential = Buffer.from(authorization.slice(6), "base64").toString("utf8");
  const colon = credential.indexOf(":");
  const account = users[credential.slice(0, colon)];
  if (colon < 0 || !account?.password || !account.raUser || !equal(account.password, credential.slice(colon + 1))) throw new ApiError("Invalid credentials", 401);
  return account.raUser;
}

export function apiError(error: unknown) {
  const status = error instanceof ApiError ? error.status : 400;
  return Response.json({ error: error instanceof Error ? error.message : "Request failed" }, {
    status,
    headers: status === 401 && !loginConfigured() ? { "WWW-Authenticate": 'Basic realm="Knowledge Studio", charset="UTF-8"' } : undefined,
  });
}
