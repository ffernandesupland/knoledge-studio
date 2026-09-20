import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTokenCache, getToken } from "./auth";

afterEach(() => {
  clearTokenCache();
  vi.unstubAllGlobals();
});

describe("RightAnswers connection authentication", () => {
  it("exchanges a Basic credential for a cached JWT using the selected company and user", async () => {
    const claims = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 900 })).toString("base64url");
    const jwt = `header.${claims}.signature`;
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ jwtoken: jwt })));
    vi.stubGlobal("fetch", fetch);
    const connection = { id: "allstate", baseUrl: "https://qa-allstate.example/portal", bearerToken: "Basic encoded", companyCode: "allstate", user: "ratest" };

    await expect(getToken("platform-user", connection)).resolves.toBe(jwt);
    await expect(getToken("platform-user", connection)).resolves.toBe(jwt);

    expect(fetch).toHaveBeenCalledOnce();
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/rest/login?");
    expect(url).toContain("companyCode=allstate");
    expect(url).toContain("imp_user=ratest");
    expect(init.headers).toMatchObject({ Authorization: "Basic encoded" });
  });

  it("uses a saved JWT directly without calling login", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const jwt = "header.payload.signature";
    await expect(getToken("platform-user", { id: "saved", bearerToken: jwt, companyCode: "tenant" })).resolves.toBe(jwt);
    expect(fetch).not.toHaveBeenCalled();
  });
});
