// Usage: node --env-file=.env scripts/auth-smoke.mjs
// Local HTTP checks only. Does not call AI, write to RA, or print credentials/cookies.
import assert from "node:assert/strict";
const base = "http://127.0.0.1:3000";
const jar = new Map();
async function request(path, init = {}) {
  const response = await fetch(`${base}${path}`, { ...init, redirect: "manual", headers: { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...init.headers } });
  for (const header of response.headers.getSetCookie()) {
    const pair = header.split(";", 1)[0]; const i = pair.indexOf("="); jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return response;
}
const page = await request("/"); assert.equal(page.status, 307); assert.match(page.headers.get("location"), /\/login/);
assert.equal((await request("/api/runs/executions")).status, 401);
assert.equal((await request("/login")).status, 200);
async function form(path, extra) {
  const csrf = await (await request("/api/auth/csrf")).json();
  return request(path, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", origin: base, "X-Auth-Return-Redirect": "1" }, body: new URLSearchParams({ csrfToken: csrf.csrfToken, callbackUrl: base, ...extra }) });
}
await form("/api/auth/callback/credentials", { username: process.env.KS_AUTH_USERNAME, password: "intentionally-incorrect" });
assert.equal((await request("/api/runs/executions")).status, 401);
await form("/api/auth/callback/credentials", { username: process.env.KS_AUTH_USERNAME, password: process.env.KS_AUTH_PASSWORD });
assert.equal((await request("/")).status, 200);
assert.equal((await request("/api/runs/latest")).status, 200);
assert.equal((await request("/flow?view=executed")).status, 200);
await form("/api/auth/signout", {});
assert.equal((await request("/api/runs/latest")).status, 401);
console.log("PASS: page/API protection, invalid login, valid login, flow access, and sign-out.");
