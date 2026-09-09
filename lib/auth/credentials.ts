import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const matches = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());
export function loginConfigured() {
  return !!(process.env.KS_AUTH_USERNAME && process.env.KS_AUTH_PASSWORD && process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32);
}
export function loginActor() { return process.env.KS_AUTH_RA_USER || process.env.KS_PILOT_AUTHOR || "sauser"; }
/** Rotating any login setting invalidates existing sessions. Nothing secret reaches the browser. */
export function credentialVersion() {
  return createHmac("sha256", process.env.AUTH_SECRET ?? "").update(JSON.stringify([process.env.KS_AUTH_USERNAME, process.env.KS_AUTH_PASSWORD, loginActor()])).digest("hex");
}
export function verifyLogin(username: unknown, password: unknown) {
  if (!loginConfigured() || typeof username !== "string" || typeof password !== "string" || username.length > 200 || password.length > 1024) return null;
  const userMatches = matches(username, process.env.KS_AUTH_USERNAME!);
  const passwordMatches = matches(password, process.env.KS_AUTH_PASSWORD!);
  return userMatches && passwordMatches ? { id: loginActor(), name: process.env.KS_AUTH_USERNAME! } : null;
}
export function safeReturnPath(value?: string | null) {
  return value?.startsWith("/") && !value.startsWith("//") && !value.includes("\\") && !/[\r\n]/.test(value) ? value : "/";
}
