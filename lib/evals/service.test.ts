import { describe, expect, it } from "vitest";
import { evaluationSignature, scoreJudgment } from "./service";
import type { EvaluationJudgment, EvaluationRubric, PipelineEvalDescriptor } from "./types";

const descriptor: PipelineEvalDescriptor = {
  version: 1,
  path: "improve",
  draftKind: "revise",
  merged: false,
  operations: ["Apply content standards", "Optimize for search"],
  template: { name: "Troubleshooting", fields: ["Cause", "Resolution"] },
  context: { ground: false, standards: true, snippets: false, demandRequirements: false },
};
const rubric: EvaluationRubric = {
  title: "Knowledge draft quality",
  summary: "Checks the final draft against its fixed scenario.",
  criteria: [
    { id: "factual_grounding", title: "Factual grounding", description: "Supported by the source.", weight: 3, evidenceRequired: "Source passage" },
    { id: "structure", title: "Structure", description: "Uses the template clearly.", weight: 1, evidenceRequired: "Prepared field" },
    { id: "standards", title: "Standards", description: "Follows applicable standards.", weight: 2, evidenceRequired: "Draft text" },
    { id: "usefulness", title: "Usefulness", description: "Helps the intended reader.", weight: 2, evidenceRequired: "Draft text" },
  ],
};

describe("evaluation scoring", () => {
  it("creates a stable signature for the same fixed pipeline descriptor", () => {
    expect(evaluationSignature(descriptor)).toBe(evaluationSignature({ ...descriptor, operations: [...descriptor.operations] }));
  });

  it("calculates a weighted score from the fixed rubric", () => {
    const judgment: EvaluationJudgment = { summary: "Measured.", criteria: [
      { criterionId: "factual_grounding", score: 4, verdict: "met", explanation: "Supported.", evidence: ["Source"] },
      { criterionId: "structure", score: 2, verdict: "partially_met", explanation: "Partial.", evidence: ["Field"] },
      { criterionId: "standards", score: 3, verdict: "partially_met", explanation: "Mostly met.", evidence: ["Draft"] },
      { criterionId: "usefulness", score: 0, verdict: "not_met", explanation: "Missing.", evidence: [] },
    ] };
    expect(scoreJudgment(rubric, judgment)).toBe(62.5);
  });
});
