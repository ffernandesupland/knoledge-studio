import { expect, it } from "vitest";
import { standardsForPlan } from "./standards";
import type { CapturedConfigurationSnapshot } from "./snapshots";
import type { WriteOp } from "../pipeline/submit";

const profile = (id: string, scope: { collection?: string; taxonomy?: string }, isDefault = false) => ({ id, connectionId: "environment", kind: "content_standard" as const, name: id, scope, isDefault, guidance: "", status: "active" as const, revision: 1, createdAt: "now", updatedAt: "now", sources: [{ type: "text" as const, label: `${id} source`, content: `${id} rule`, version: "hash" }] });
const snapshot: CapturedConfigurationSnapshot = { capturedAt: "now", profiles: [profile("default", {}, true), profile("vpn", { taxonomy: "Products//VPN" })] };
const plan: WriteOp[] = [{ kind: "create", candidateKey: "vpn", title: "VPN", templateName: "How to", fields: [], idempotencyKey: "vpn", metadata: { collections: ["Support"], taxonomies: ["Products//VPN//Access"] } }, { kind: "create", candidateKey: "other", title: "Other", templateName: "How to", fields: [], idempotencyKey: "other", metadata: { collections: ["Support"] } }];

it("uses a scoped frozen profile per output instead of merging it with the default", () => {
  const standards = standardsForPlan(snapshot, plan, ["Legacy rule"]);
  expect(standards.vpn[0]).toContain("vpn rule");
  expect(standards.vpn.join(" ")).not.toContain("default rule");
  expect(standards.other[0]).toContain("default rule");
});
