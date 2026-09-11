import { afterEach, describe, expect, it, vi } from "vitest";
import { raFetch } from "./http";
afterEach(() => vi.unstubAllGlobals());
describe("RA retry boundaries", () => {
  it("does not retry a POST on a lost response", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("connection lost")); vi.stubGlobal("fetch", fetch);
    await expect(raFetch("https://example.test", { method: "POST", path: "/manageSolution", retries: 5 })).rejects.toThrow("connection lost");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("does not retry a POST on a 5xx response", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("upstream failure", { status: 502 })); vi.stubGlobal("fetch", fetch);
    await expect(raFetch("https://example.test", { method: "POST", path: "/manageSolution" })).rejects.toThrow("502");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("still retries read-only requests", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response("busy", { status: 503 })).mockResolvedValueOnce(new Response("ok")); vi.stubGlobal("fetch", fetch);
    await expect(raFetch("https://example.test", { path: "/solution/1", retries: 1 })).resolves.toMatchObject({ text: "ok" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("explains template outages without exposing the HTML error page", async () => {
    const body = "<html><h1>503 Service Temporarily Unavailable</h1></html>";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status: 503 })));
    const error = await raFetch("https://example.test", { path: "/api/rest/templates", retries: 0 }).catch((e) => e);
    expect(error.message).toContain("loading article templates");
    expect(error.message).not.toContain("<html>");
    expect(error.status).toBe(503);
    expect(error.responseBody).toBe(body);
  });
});
