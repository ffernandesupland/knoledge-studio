import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { closeDatabase, useDatabase } from "../db";
import { createRun } from "../db/runs";
import { createConfigurationProfile } from "./store";
import { createSnippet } from "./snippets";
import { captureRunConfigurationSnapshots, getRunConfigurationSnapshots, saveRunConfigurationSnapshots } from "./snapshots";

vi.mock("../ra/client", () => ({ ra: { getSolution: vi.fn() } }));
let directory: string;

beforeAll(() => {
  directory = mkdtempSync(path.join(tmpdir(), "ks-config-snapshot-"));
  useDatabase(path.join(directory, "test.db"));
});
afterAll(() => {
  closeDatabase();
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* Best-effort Windows cleanup. */ }
});

it("freezes active configuration content and snippets with a run", async () => {
  await createConfigurationProfile({ connectionId: "environment", createdBy: "operator", draft: { kind: "content_standard", name: "Company standard", isDefault: true, sources: [{ type: "text", text: "Use numbered steps." }] } });
  await createConfigurationProfile({ connectionId: "environment", createdBy: "operator", draft: { kind: "ground_truth", name: "VPN reference", scope: { taxonomy: "Products//VPN" }, sources: [{ type: "text", text: "Managed devices only." }] } });
  await createSnippet({ connectionId: "environment", createdBy: "operator", draft: { name: "Prerequisites", purpose: "Use before procedures.", html: "<section><h3>Prerequisites</h3><p>Use a managed device.</p></section>", active: true, scope: {} } });
  const snapshots = await captureRunConfigurationSnapshots("environment", "operator");
  expect(snapshots.contentStandards.profiles[0].sources[0]).toMatchObject({ content: "Use numbered steps.", version: expect.stringMatching(/^\w{64}$/) });
  expect(snapshots.groundTruth.profiles[0].scope.taxonomies).toEqual(["Products//VPN"]);
  expect(snapshots.snippets.snippets).toHaveLength(1);
  await createRun({ id: "configuration-run", author: "operator", path: "create", inputText: "Write a guide", sourceIds: [], operations: [] });
  await saveRunConfigurationSnapshots("configuration-run", snapshots);
  expect((await getRunConfigurationSnapshots("configuration-run")).contentStandards?.profiles[0].name).toBe("Company standard");
});
