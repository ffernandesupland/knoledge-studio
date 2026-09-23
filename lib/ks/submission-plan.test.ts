import { expect, it } from "vitest";
import { frozenConfigurationIdentity } from "./submission-plan";

it("keeps only frozen configuration standards and snippets from a prepared identity", () => {
  const identity = JSON.stringify({ standards: ["Sentence-case headings", "[Company Standard · Handbook.pdf]\nUse direct language."], snippets: { article: ["note:2"] } });
  expect(frozenConfigurationIdentity(identity)).toEqual({ standards: ["[Company Standard · Handbook.pdf]\nUse direct language."], snippets: { article: ["note:2"] } });
});
