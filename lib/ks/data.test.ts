import { describe, expect, it } from "vitest";
import { isKsPathKey, KS_PATH_KEYS, KS_PATHS } from "@/lib/ks/data";

describe("Knowledge Studio workflow paths", () => {
  it("recognizes every supported starting point", () => {
    for (const path of KS_PATH_KEYS) {
      expect(isKsPathKey(path)).toBe(true);
      expect(KS_PATHS[path].icon).toBeTruthy();
    }
  });

  it("rejects removed, malformed, and missing persisted paths", () => {
    expect(isKsPathKey("merge")).toBe(false);
    expect(isKsPathKey("legacy-path")).toBe(false);
    expect(isKsPathKey(undefined)).toBe(false);
    expect(isKsPathKey(null)).toBe(false);
  });
});
