import { expect, it } from "vitest";
import { cleanConfigurationText } from "./clean-text";

it("repairs common extracted-document mojibake without flattening paragraphs", () => {
  expect(cleanConfigurationText("Protectiveâs  guideÂ \r\n\r\nUse  clear\tsteps.\u0000")).toBe("Protective’s guide\n\nUse clear steps.");
});

it("does not turn an invalid byte sequence into replacement characters", () => {
  expect(cleanConfigurationText("Keep Â this literal malformed marker")).toBe("Keep Â this literal malformed marker");
});
