import { expect, it } from "vitest";
import { snippetsForTarget } from "./snippet-resolution";
import type { Snippet } from "./types";

const snippet = (id: string, scope: Snippet["scope"] = {}, active = true): Snippet => ({
  id, connectionId: "environment", name: id, purpose: "Reusable structure", html: `<aside>${id}</aside>`, active, scope, revision: 1, createdAt: "2026-09-23", updatedAt: "2026-09-23",
});

it("adds matching scoped snippets beside global snippets without exposing unrelated entries", () => {
  const result = snippetsForTarget([
    snippet("global"), snippet("vpn", { taxonomy: "Access//VPN" }), snippet("it", { collection: "IT" }), snippet("hr", { collection: "HR" }), snippet("archived", {}, false),
  ], { collections: ["IT"], taxonomies: ["Access//VPN//Remote"] });
  expect(result.map(item => item.id)).toEqual(["global", "vpn", "it"]);
});
