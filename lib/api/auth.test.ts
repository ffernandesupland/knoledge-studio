import { afterEach, describe, expect, it, vi } from "vitest";
import { requireActor } from "./auth";
afterEach(() => vi.unstubAllEnvs());
describe("pilot and shared access", () => {
  it("maps configured named accounts to their RA identity", async () => {
    vi.stubEnv("KS_USERS_JSON", JSON.stringify({ author: { password: "secret", raUser: "real-author" } }));
    const request = new Request("https://studio.example/api/run", { headers: { authorization: `Basic ${Buffer.from("author:secret").toString("base64")}` } });
    expect(await requireActor(request)).toBe("real-author");
  });
  it("requires credentials when shared accounts are configured", async () => {
    vi.stubEnv("KS_USERS_JSON", JSON.stringify({ author: { password: "secret", raUser: "real-author" } }));
    await expect(requireActor(new Request("https://studio.example/api/run"))).rejects.toThrow("Sign in");
  });
  it("does not expose an anonymous production pilot", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("KS_USERS_JSON", "");
    await expect(requireActor(new Request("http://localhost/api/run"))).rejects.toThrow("Configure");
  });
  it("accepts the browser Host when Next normalizes Request.url", async () => {
    vi.stubEnv("KS_USERS_JSON", ""); vi.stubEnv("NODE_ENV", "test");
    const request = new Request("http://localhost:3000/api/run", { headers: { host: "127.0.0.1:3000", origin: "http://127.0.0.1:3000" } });
    expect(await requireActor(request)).toBe("sauser");
  });
  it("does not give a non-local Host anonymous pilot access", async () => {
    vi.stubEnv("KS_USERS_JSON", ""); vi.stubEnv("NODE_ENV", "test");
    await expect(requireActor(new Request("http://localhost:3000/api/run", { headers: { host: "attacker.example", origin: "http://attacker.example" } }))).rejects.toThrow("Configure");
  });
  it("rejects cross-origin mutations", async () => {
    await expect(requireActor(new Request("http://localhost/api/run", { headers: { origin: "https://other.example" } }))).rejects.toThrow("Cross-origin");
  });
});
