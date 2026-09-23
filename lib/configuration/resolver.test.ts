import { expect, it } from "vitest";
import { configurationProfileDraftSchema } from "./types";
import { ConfigurationResolutionConflictError, configurationScopeKey, findScopeConflicts, resolveConfigurationProfile, taxonomyMatches } from "./resolver";
import type { ConfigurationProfile } from "./types";

const source = { type: "text" as const, text: "Use concise language." };
const scope = (collections: string[] = [], taxonomies: string[] = [], operator: "and" | "or" = "and"): ConfigurationProfile["scope"] => ({ collections, taxonomies, operator });
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
    profile("default", scope(), true),
    profile("collection", scope(["Support"])),
    profile("taxonomy", scope([], ["Products//VPN"])),
    profile("combined", scope(["Support"], ["Products//VPN"])),
  ];
  expect(resolveConfigurationProfile(profiles, { collections: ["Support"], taxonomies: ["Products//VPN//Access"] })).toMatchObject({ profile: { id: "combined" }, reason: "collection-and-taxonomy" });
  expect(resolveConfigurationProfile(profiles, { collections: ["Other"], taxonomies: ["Products//VPN//Access"] })).toMatchObject({ profile: { id: "taxonomy" }, reason: "taxonomy" });
  expect(resolveConfigurationProfile(profiles, { collections: ["Support"] })).toMatchObject({ profile: { id: "collection" }, reason: "collection" });
  expect(resolveConfigurationProfile(profiles, { collections: ["Other"] })).toMatchObject({ profile: { id: "default" }, reason: "company-default" });
  expect(taxonomyMatches("Products//VPN", "Products//VPN//Access")).toBe(true);
  expect(taxonomyMatches("Products//VPN", "Products//VPNs")).toBe(false);
});

it("does not select archived profiles and rejects equally specific matches", () => {
  const archived = { ...profile("archived", scope(["Support"])), status: "archived" as const };
  expect(resolveConfigurationProfile([archived, profile("default", scope(), true)], { collections: ["Support"] })).toMatchObject({ profile: { id: "default" } });
  expect(() => resolveConfigurationProfile([profile("vpn", scope([], ["Products//VPN"])), profile("support", scope([], ["Products//Support"]))], { taxonomies: ["Products//VPN", "Products//Support"] })).toThrow(ConfigurationResolutionConflictError);
});

it("finds duplicate active scopes with normalized values", () => {
  const existing = profile("existing", scope([" Support "], ["Products//VPN"]));
  const candidate = profile("candidate", scope(["support"], ["products//vpn"]));
  expect(findScopeConflicts([existing], candidate).map((item) => item.id)).toEqual(["existing"]);
  expect(configurationScopeKey(scope(), true)).toBe("default");
});

it("matches any selected collection and taxonomy pair for AND, but permits either side for OR", () => {
  const andProfile = profile("and", scope(["Support", "IT"], ["Products//VPN", "HR//Benefits"], "and"));
  expect(resolveConfigurationProfile([andProfile], { collections: ["IT"], taxonomies: ["Products//VPN//Access"] })).toMatchObject({ profile: { id: "and" }, reason: "collection-and-taxonomy" });
  expect(resolveConfigurationProfile([andProfile], { collections: ["IT"] })).toBeUndefined();
  expect(resolveConfigurationProfile([andProfile], { taxonomies: ["HR//Benefits"] })).toBeUndefined();

  const orProfile = profile("or", scope(["Support", "IT"], ["Products//VPN"], "or"));
  expect(resolveConfigurationProfile([orProfile], { collections: ["Support"] })).toMatchObject({ profile: { id: "or" }, reason: "collection" });
  expect(resolveConfigurationProfile([orProfile], { taxonomies: ["Products//VPN//Access"] })).toMatchObject({ profile: { id: "or" }, reason: "taxonomy" });
});
