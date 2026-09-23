import { expect, it } from "vitest";
import { configurationProfileDraftSchema } from "./types";
import { ConfigurationResolutionConflictError, configurationScopeKey, findScopeConflicts, resolveConfigurationProfile, taxonomyMatches } from "./resolver";
import type { ConfigurationProfile } from "./types";

const source = { type: "text" as const, text: "Use concise language." };
function profile(id: string, scope: ConfigurationProfile["scope"], isDefault = false): ConfigurationProfile {
  return { id, connectionId: "customer", kind: "content_standard", name: id, scope, isDefault, guidance: "", sources: [source], status: "active", revision: 1, createdAt: "2026-09-23", updatedAt: "2026-09-23" };
}

it("requires every profile to be either the default or scoped", () => {
  expect(configurationProfileDraftSchema.safeParse({ kind: "content_standard", name: "Unscoped", sources: [source] }).success).toBe(false);
  expect(configurationProfileDraftSchema.safeParse({ kind: "content_standard", name: "Default", isDefault: true, sources: [source] }).success).toBe(true);
  expect(configurationProfileDraftSchema.safeParse({ kind: "ground_truth", name: "Scoped", scope: { taxonomy: "Products//VPN" }, sources: [source] }).success).toBe(true);
  expect(configurationProfileDraftSchema.safeParse({ kind: "content_standard", name: "Invalid default", isDefault: true, scope: { collection: "Support" }, sources: [source] }).success).toBe(false);
});

it("uses the documented precedence and allows taxonomy descendants", () => {
  const profiles = [
    profile("default", {}, true),
    profile("collection", { collection: "Support" }),
    profile("taxonomy", { taxonomy: "Products//VPN" }),
    profile("combined", { collection: "Support", taxonomy: "Products//VPN" }),
  ];
  expect(resolveConfigurationProfile(profiles, { collections: ["Support"], taxonomies: ["Products//VPN//Access"] })).toMatchObject({ profile: { id: "combined" }, reason: "collection-and-taxonomy" });
  expect(resolveConfigurationProfile(profiles, { collections: ["Other"], taxonomies: ["Products//VPN//Access"] })).toMatchObject({ profile: { id: "taxonomy" }, reason: "taxonomy" });
  expect(resolveConfigurationProfile(profiles, { collections: ["Support"] })).toMatchObject({ profile: { id: "collection" }, reason: "collection" });
  expect(resolveConfigurationProfile(profiles, { collections: ["Other"] })).toMatchObject({ profile: { id: "default" }, reason: "company-default" });
  expect(taxonomyMatches("Products//VPN", "Products//VPN//Access")).toBe(true);
  expect(taxonomyMatches("Products//VPN", "Products//VPNs")).toBe(false);
});

it("does not select archived profiles and rejects equally specific matches", () => {
  const archived = { ...profile("archived", { collection: "Support" }), status: "archived" as const };
  expect(resolveConfigurationProfile([archived, profile("default", {}, true)], { collections: ["Support"] })).toMatchObject({ profile: { id: "default" } });
  expect(() => resolveConfigurationProfile([profile("vpn", { taxonomy: "Products//VPN" }), profile("support", { taxonomy: "Products//Support" })], { taxonomies: ["Products//VPN", "Products//Support"] })).toThrow(ConfigurationResolutionConflictError);
});

it("finds duplicate active scopes with normalized values", () => {
  const existing = profile("existing", { collection: " Support ", taxonomy: "Products//VPN" });
  const candidate = profile("candidate", { collection: "support", taxonomy: "products//vpn" });
  expect(findScopeConflicts([existing], candidate).map((item) => item.id)).toEqual(["existing"]);
  expect(configurationScopeKey({}, true)).toBe("default");
});
