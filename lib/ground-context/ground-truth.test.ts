import { expect, it } from "vitest";
import { resolveGroundTruthSelection } from "./ground-truth";
import type { CapturedConfigurationSnapshot } from "../configuration/snapshots";

const defaultProfile = {
  id: "11111111-1111-4111-8111-111111111111",
  connectionId: "environment",
  kind: "ground_truth" as const,
  name: "Company policy",
  scope: { collections: [], taxonomies: [], operator: "and" as const },
  isDefault: true,
  guidance: "Use company policy.",
  status: "active" as const,
  revision: 1,
  createdAt: "2026-09-23T00:00:00.000Z",
  updatedAt: "2026-09-23T00:00:00.000Z",
  sources: [{ type: "text" as const, label: "Written instruction", content: "All articles need an owner.", version: "default-v1" }],
};

const scopedProfile = {
  ...defaultProfile,
  id: "22222222-2222-4222-8222-222222222222",
  name: "VPN policy",
  scope: { collections: ["IT"], taxonomies: ["Access//VPN"], operator: "and" as const },
  isDefault: false,
  sources: [{ type: "text" as const, label: "Written instruction", content: "VPN articles must state device requirements.", version: "vpn-v1" }],
};

const snapshot = (profiles = [defaultProfile, scopedProfile]): CapturedConfigurationSnapshot => ({
  capturedAt: "2026-09-23T00:00:00.000Z",
  profiles,
});

it("uses the requested saved bundle even when a more specific scope exists", async () => {
  const resolved = await resolveGroundTruthSelection(
    { mode: "bundle", bundleId: defaultProfile.id, guidance: "Use this as the source of truth." },
    snapshot(), "environment", [], "author",
  );

  expect(resolved.selection.mode).toBe("bundle");
  expect(resolved.selection.guidance).toBe("Use company policy.\n\nUse this as the source of truth.");
  expect(resolved.references).toMatchObject([{ title: "Written instruction", sourceType: "text", body: "All articles need an owner." }]);
});

it("matches the most specific scope and freezes its written sources", async () => {
  const resolved = await resolveGroundTruthSelection(
    { mode: "scope", scope: { collection: "IT", taxonomy: "Access//VPN//Remote" }, guidance: "" },
    snapshot(), "environment", [], "author",
  );

  expect(resolved.selection).toMatchObject({ mode: "scope", bundleId: scopedProfile.id, scope: { collection: "IT", taxonomy: "Access//VPN//Remote" } });
  expect(resolved.references[0]).toMatchObject({ sourceType: "text", body: "VPN articles must state device requirements.", version: "vpn-v1" });
});

it("requires a matching profile or company default for scope mode", async () => {
  await expect(resolveGroundTruthSelection(
    { mode: "scope", scope: { collection: "HR" }, guidance: "" },
    snapshot([scopedProfile]), "environment", [], "author",
  )).rejects.toThrow("No Ground Truth bundle matches");
});
