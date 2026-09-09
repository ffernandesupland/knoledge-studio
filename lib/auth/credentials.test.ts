import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encode } from "next-auth/jwt";
import { credentialVersion, safeReturnPath, verifyLogin } from "./credentials";
import { requireActor } from "../api/auth";
beforeEach(() => {
  vi.stubEnv("KS_AUTH_USERNAME", "admin"); vi.stubEnv("KS_AUTH_PASSWORD", "test-password-only");
  vi.stubEnv("AUTH_SECRET", "test-secret-that-is-at-least-32-characters"); vi.stubEnv("KS_AUTH_RA_USER", "sauser");
  vi.stubEnv("KS_PUBLIC_ORIGIN", ""); vi.stubEnv("VERCEL", "");
});
afterEach(() => vi.unstubAllEnvs());
const cookie = "authjs.session-token";
const token = (maxAge = 3600) => encode({ secret: process.env.AUTH_SECRET!, salt: cookie, token: { sub: "sauser", credentialVersion: credentialVersion() }, maxAge });
const request = (value: string) => new Request("http://localhost/api/runs/executions", { headers: { cookie: `${cookie}=${value}` } });
describe("environment credentials and sessions", () => {
  it("checks both credentials and preserves the existing run owner", () => {
    expect(verifyLogin("admin", "test-password-only")).toEqual({ id: "sauser", name: "admin" });
    expect(verifyLogin("other", "test-password-only")).toBeNull(); expect(verifyLogin("admin", "wrong")).toBeNull();
    expect(verifyLogin({}, "wrong")).toBeNull();
  });
  it("protects local APIs too once login is configured", async () => {
    await expect(requireActor(new Request("http://localhost/api/run"))).rejects.toThrow("Sign in");
    await expect(requireActor(request(await token()))).resolves.toBe("sauser");
  });
  it("rejects tampered, expired and password-rotated sessions", async () => {
    const current = await token();
    await expect(requireActor(request(`${current}broken`))).rejects.toThrow("Sign in");
    await expect(requireActor(request(await token(-120)))).rejects.toThrow("Sign in");
    vi.stubEnv("KS_AUTH_PASSWORD", "a-new-password");
    await expect(requireActor(request(current))).rejects.toThrow("Sign in");
  });
  it("fails closed when environment settings are incomplete", async () => {
    vi.stubEnv("AUTH_SECRET", "short"); expect(verifyLogin("admin", "test-password-only")).toBeNull();
    await expect(requireActor(request("anything"))).rejects.toThrow("Configure");
  });
  it("keeps login return destinations on this site", () => {
    expect(safeReturnPath("/flow?view=executed&runId=abc")).toBe("/flow?view=executed&runId=abc");
    for (const path of ["https://outside.example", "//outside.example", "/\\outside.example", "/\nLocation:x"]) expect(safeReturnPath(path)).toBe("/");
  });
});
