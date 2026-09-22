import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ operation: vi.fn() }));
vi.mock("../llm/client", () => ({ runOperation: mocks.operation }));

import { assessDemandCompliance, validateDemandCompliance } from "./compliance";
import type { ScopedDirective } from "./spec";

const prepared = { version: "v1", title: "VPN setup", summary: "A technician procedure.", keywords: ["vpn"], templateName: "Article", fields: [{ fieldName: "Solution", fieldValue: "<ol><li>Connect to the approved VPN.</li></ol>" }], warnings: [] };
const directive: ScopedDirective = { id: "operator-1", source: "operator", text: "Use numbered steps.", priority: "required", appliesTo: ["quality"] };

describe("demand compliance assessment", () => {
  it("keeps requirements separate from facts and checks draft-only evidence", () => {
    assessDemandCompliance(prepared, [directive]);
    const args = mocks.operation.mock.calls[0][0];
    expect(args.operation).toBe("demandCompliance");
    expect(args.task).toContain("factual evidence");
    expect(() => validateDemandCompliance({ summary: "Met.", checks: [{ directiveId: "operator-1", verdict: "met", rationale: "The draft has ordered steps.", draftEvidence: ["Connect to the approved VPN."] }] }, prepared, [directive])).not.toThrow();
    expect(() => validateDemandCompliance({ summary: "Met.", checks: [{ directiveId: "operator-1", verdict: "met", rationale: "The draft has ordered steps.", draftEvidence: ["Invented evidence"] }] }, prepared, [directive])).toThrow("not present");
  });
});
