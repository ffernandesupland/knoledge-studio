import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase, db, useDatabase } from "../db";
import { ConfigurationScopeConflictError, archiveConfigurationProfile, createConfigurationProfile, listConfigurationProfiles, updateConfigurationProfile } from "./store";

let directory: string;
const connectionId = "environment";
const text = { type: "text", text: "Use short, direct sentences." } as const;

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ks-config-"));
  useDatabase(path.join(directory, "test.db"));
});
afterAll(() => {
  closeDatabase();
  // libsql can release the Windows file handle just after closeDatabase returns.
  // A failed temporary-directory cleanup must not hide the persistence assertions.
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* Best-effort test cleanup on Windows. */ }
});

describe("configuration profile storage", () => {
  it("persists mixed profile sources and increments revisions", async () => {
    const created = await createConfigurationProfile({ connectionId, createdBy: "operator", draft: { kind: "content_standard", name: "Company standard", isDefault: true, sources: [text, { type: "solution", solutionId: "260923000000001" }] } });
    expect(created.revision).toBe(1);
    expect((await listConfigurationProfiles(connectionId, "content_standard"))[0].sources).toHaveLength(2);
    const updated = await updateConfigurationProfile({ id: created.id, connectionId, draft: { kind: "content_standard", name: "Company standard", isDefault: true, guidance: "Use this only for final drafts.", sources: [text] } });
    expect(updated.revision).toBe(2);
    expect(updated.guidance).toContain("final drafts");
  });

  it("prevents duplicate active scopes but allows an archived predecessor", async () => {
    const first = await createConfigurationProfile({ connectionId, createdBy: "operator", draft: { kind: "ground_truth", name: "VPN evidence", scope: { taxonomy: "Products//VPN" }, sources: [text] } });
    await expect(createConfigurationProfile({ connectionId, createdBy: "operator", draft: { kind: "ground_truth", name: "Duplicate VPN evidence", scope: { taxonomy: "products//vpn" }, sources: [text] } })).rejects.toBeInstanceOf(ConfigurationScopeConflictError);
    await archiveConfigurationProfile(first.id, connectionId);
    await expect(createConfigurationProfile({ connectionId, createdBy: "operator", draft: { kind: "ground_truth", name: "Replacement VPN evidence", scope: { taxonomy: "products//vpn" }, sources: [text] } })).resolves.toMatchObject({ name: "Replacement VPN evidence" });
  });

  it("persists multi-value scopes and their AND/OR matching rule", async () => {
    const created = await createConfigurationProfile({ connectionId, createdBy: "operator", draft: { kind: "content_standard", name: "Support and VPN", scope: { collections: ["Support", "IT"], taxonomies: ["Products//VPN", "HR//Benefits"], operator: "or" }, sources: [text] } });
    expect(created.scope).toEqual({ collections: ["Support", "IT"], taxonomies: ["Products//VPN", "HR//Benefits"], operator: "or" });
    const loaded = (await listConfigurationProfiles(connectionId, "content_standard")).find(profile => profile.id === created.id);
    expect(loaded?.scope).toEqual(created.scope);
  });

  it("reads a profile saved with the former singular scope columns", async () => {
    await db().prepare("INSERT INTO configuration_profiles(id,connection_id,kind,name,scope_collection,scope_taxonomy,is_default,status,guidance,revision,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run("legacy-scope", connectionId, "ground_truth", "Legacy scope", "Support", "Products//VPN", 0, "active", "", 1, "operator", "2026-09-23", "2026-09-23");
    const legacy = (await listConfigurationProfiles(connectionId, "ground_truth")).find(profile => profile.id === "legacy-scope");
    expect(legacy?.scope).toEqual({ collections: ["Support"], taxonomies: ["Products//VPN"], operator: "and" });
  });
});
