import { describe, expect, it } from "vitest";
import { autonomousMetadataValues } from "./metadata";
import type { MetadataSuggestion } from "../metadata/types";

const suggestion = (kind: MetadataSuggestion["option"]["kind"], value: string): MetadataSuggestion => ({
  option: { id: value, kind, value, label: value, origin: "catalog" },
  reason: "Supported", sourceEvidence: "VPN", exampleIds: [], alreadyAssigned: false,
});
describe("autonomous metadata policy", () => {
  it("respects explicit destinations while applying supported taxonomies and excluding observed attributes", () => {
    expect(autonomousMetadataValues({ suggestions: [suggestion("collection", "support"), suggestion("taxonomy", "VPN"), suggestion("attribute", "internal")] }, { collection: "private", language: "Portuguese" }))
      .toEqual({ collections: ["private"], taxonomies: ["VPN"], language: "Portuguese" });
  });
  it("abstains without clearing existing taxonomy or overwriting inherited metadata", () => {
    expect(autonomousMetadataValues({ suggestions: [] }, {})).toEqual({});
  });
});
