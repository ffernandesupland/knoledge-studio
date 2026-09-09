import { planContent } from "../llm/planning";
import { z } from "zod";
import { inspectPrompt } from "../llm/client";
import { buildUserPrompt, systemPrompt } from "../llm/prompt";
import { applyStandards, chooseTemplate, findGaps, mergeSections, optimizeForSearch, restructure, splitTopics } from "../llm/operations";
import { adjudicateDuplicates, findIntraBatchOverlaps, generateSearchQuery } from "../pipeline/dedupe";
import { modelFor } from "../llm/models";
import { PROMPT_VERSION } from "../llm/audit";
import type { WSTemplate } from "../ra/types";

export interface PromptExample { id: string; model: string; version: string; system: string; user: string; schema: string }
/** These examples execute the production prompt builders, with SDK invocation intercepted. */
export async function promptCatalog(): Promise<PromptExample[]> {
  const template: WSTemplate = { templateName: "How To (RA)", templateType: "standard", kbPrefix: "", fields: ["Solution", "Details", "Symptoms"].map((fieldName) => ({ fieldName, description: "", required: false, searchable: true })) };
  const blocks = [{ label: "source content", content: "{{content}}" }];
  const candidate = { key: "c0", title: "Example article", body: "{{content}}" };
  const builders: [string, () => unknown][] = [
    ["plan", () => planContent([{ key: "c0", title: "Example topic", content: "{{content}}", sourceLabels: ["pasted text"], proposedAction: "create", reason: "One supported topic", duplicateEvidence: { checked: false } }], ["Split topics"], ["Split topics: new content"], [])],
    ["split", () => splitTopics(blocks)],
    ["chooseTemplate", () => chooseTemplate({ title: candidate.title, content: candidate.body }, [template])],
    ["compose", () => restructure(blocks, template, undefined, true)],
    ["restructure", () => restructure(blocks, template)],
    ["mergeSections", () => mergeSections([{ label: "Survivor", templateName: template.templateName, body: "{{content}}" }, { label: "Other source", templateName: template.templateName, body: "{{other article content}}" }], template)],
    ["standards", () => applyStandards([{ fieldName: "Solution", fieldValue: "{{content}}" }], ["Sentence-case headings", "Second person", "Numbered steps"])],
    ["optimizeSearch", () => optimizeForSearch({ title: candidate.title, body: candidate.body, keywords: ["original keyword"] }, ["{{logged user search}}"] )],
    ["dedupeQuery", () => generateSearchQuery(candidate)],
    ["dedupeAdjudicate", () => adjudicateDuplicates(candidate, [{ id: "260909000000001", title: "Retrieved article", status: "Published", fields: [{ name: "Solution", content: "{{retrieved full article}}" }] }])],
    ["batchAdjudicate", () => findIntraBatchOverlaps([candidate, { key: "c1", title: "Second draft", body: "{{second draft}}" }])],
    ["findGaps", () => findGaps([{ query: "{{logged user search}}", topResultTitles: ["Retrieved article"], articles: ["{{retrieved full article}}"] }])],
  ];
  return Promise.all(builders.map(async ([id, fn]) => {
    const args = await inspectPrompt(fn);
    return { id, model: modelFor(args.operation), version: PROMPT_VERSION, system: systemPrompt(args.role), user: buildUserPrompt(args.task, args.blocks ?? [], "example-boundary"), schema: JSON.stringify(z.toJSONSchema(args.schema), null, 2) };
  }));
}
