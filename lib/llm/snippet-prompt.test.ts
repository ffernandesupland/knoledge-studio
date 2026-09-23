import { expect, it } from "vitest";
import { inspectPrompt } from "./client";
import { applyStandards, mergeSections, restructure } from "./operations";

const template = { templateName: "How to", templateType: "solution", kbPrefix: "", fields: [{ fieldName: "Answer", required: true, description: "", searchable: false }] };
const snippets = [{ id: "snippet-note", name: "Note", purpose: "Call out a supported warning", html: '<aside class="note"><strong>Note</strong><p>Supported warning</p></aside>', revision: 2 }];

it("exposes approved snippets only to authoring, merge, and standards operations", async () => {
  const authored = await inspectPrompt(() => restructure([{ label: "source", content: "A supported warning" }], template, undefined, false, [], snippets));
  const merged = await inspectPrompt(() => mergeSections([{ label: "First", templateName: "How to", body: "A supported warning" }], template, [], [], snippets));
  const standards = await inspectPrompt(() => applyStandards([{ fieldName: "Answer", fieldValue: "<p>A supported warning</p>" }], ["Use concise notes"], [], snippets));

  for (const prompt of [authored, merged, standards]) {
    expect(prompt.task).toContain("Approved reusable HTML snippets");
    expect(prompt.blocks?.some(block => block.label.includes("Approved reusable HTML snippet: Note"))).toBe(true);
  }
});
