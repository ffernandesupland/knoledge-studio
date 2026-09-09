import { describe, expect, it } from "vitest";
import { isLive, toWriteStatus } from "@/lib/ra/status";
import {
  assertWriteSucceeded,
  parseRevisionLink,
  parseSolutionId,
  pendingRevisionId,
} from "@/lib/ra/parse";

describe("parseRevisionLink", () => {
  it("reads the parent side of the link", () => {
    expect(parseRevisionLink("child260903131615653")).toEqual({
      role: "child",
      id: "260903131615653",
    });
  });

  it("reads the revision side of the link", () => {
    expect(parseRevisionLink("parent260903131608980")).toEqual({
      role: "parent",
      id: "260903131608980",
    });
  });

  it("returns null for missing or unrecognised values", () => {
    expect(parseRevisionLink(null)).toBeNull();
    expect(parseRevisionLink("")).toBeNull();
    expect(parseRevisionLink("sibling123")).toBeNull();
  });

  it("only reports a pending revision from the parent side", () => {
    // A parent may hold only one pending revision (V16), so this decides whether a new
    // revision can be created or the existing one must be edited.
    expect(pendingRevisionId("child260903131615653")).toBe("260903131615653");
    expect(pendingRevisionId("parent260903131608980")).toBeNull();
    expect(pendingRevisionId(null)).toBeNull();
  });
});

describe("status vocabulary", () => {
  it("maps RA read values to write values", () => {
    expect(toWriteStatus("Published")).toBe("approved");
    expect(toWriteStatus("Draft")).toBe("draft");
    expect(toWriteStatus("In Review")).toBe("review");
    expect(toWriteStatus("Archived")).toBe("archived");
  });

  it("is case and whitespace tolerant", () => {
    expect(toWriteStatus("  published ")).toBe("approved");
  });

  it("returns null for unknown values rather than guessing", () => {
    expect(toWriteStatus("Something else")).toBeNull();
    expect(toWriteStatus(undefined)).toBeNull();
  });

  it("treats only Published as live", () => {
    // Guarding on the write value "approved" would never fire against real read data.
    expect(isLive("Published")).toBe(true);
    expect(isLive("Draft")).toBe(false);
    expect(isLive("Archived")).toBe(false);
  });
});

describe("parseSolutionId", () => {
  it("pulls the id out of a plain-text write response", () => {
    expect(parseSolutionId("Successfully created solution with ID: 260903131608980")).toBe(
      "260903131608980",
    );
    expect(parseSolutionId("Successfully updated solution with ID: 260903131608980")).toBe(
      "260903131608980",
    );
  });

  it("returns empty when there is no id", () => {
    expect(parseSolutionId("Could not save solution.Solution title must not be blank")).toBe("");
  });
});

describe("assertWriteSucceeded", () => {
  it("passes a successful write through", () => {
    const ok = "Successfully created solution with ID: 260903131608980";
    expect(assertWriteSucceeded(ok)).toBe(ok);
  });

  it("throws on a 200-OK plain-text failure", () => {
    expect(() =>
      assertWriteSucceeded("Could not save solution.User does not have access to save in the solution status"),
    ).toThrow(/does not have access/);
  });

  it("throws on the blank-title rejection", () => {
    expect(() =>
      assertWriteSucceeded("Could not save solution.Solution title must not be blank"),
    ).toThrow(/must not be blank/);
  });
});
