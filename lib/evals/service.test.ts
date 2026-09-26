import { describe, expect, it } from "vitest";
import { buildEvaluationDimensions, evaluationSignature, scoreJudgment } from "./service";
import type { ExecuteArgs, PreparedContent } from "../pipeline/execute";
import type { StoredRun } from "../db/runs";
import type { EvaluationJudgment, EvaluationRubric, PipelineEvalDescriptor } from "./types";

const descriptor: PipelineEvalDescriptor = {
  version: 3,
  dimension: "content_standards",
  dimensionLabel: "Content standards",
  action: "Apply content standards",
  configurationIdentity: "frozen-standard-rules-v1",
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
  it("creates a stable signature for one fixed evaluation dimension", () => {
    expect(evaluationSignature(descriptor)).toBe(evaluationSignature({ ...descriptor }));
    expect(evaluationSignature(descriptor)).not.toBe(evaluationSignature({ ...descriptor, configurationIdentity: "different-standard-rules" }));
  });

  it("uses one standards dimension regardless of the output template", () => {
    const run = { operations: ["Apply content standards"] } as StoredRun;
    const execution = { plan: [{ idempotencyKey: "draft-1", kind: "revise", candidateKey: "candidate-1" }] } as ExecuteArgs;
    const prepared = (templateName: string): PreparedContent => ({ version: "draft-v1", title: "VPN", summary: "", keywords: [], templateName, fields: [], warnings: [], standardsApplied: true, standardsUsed: ["[Company standard]\nUse clear commands."], ruleResults: [] });
    const howTo = buildEvaluationDimensions(run, execution, "draft-1", prepared("How To (RA)"));
    const error = buildEvaluationDimensions(run, execution, "draft-1", prepared("Error (RA)"));
    expect(howTo).toHaveLength(1);
    expect(howTo[0].descriptor.dimension).toBe("content_standards");
    expect(evaluationSignature(howTo[0].descriptor)).toBe(evaluationSignature(error[0].descriptor));
  });

  it("adds a stable deduplication dimension only for an output with duplicate evidence", () => {
    const run = {
      operations: ["Find duplicates"],
      candidates: [{ key: "candidate-1", title: "VPN setup", action: "Merge", why: "The articles cover the same setup.", duplicates: [{ solutionId: "123456789012345", title: "VPN configuration", similarity: 92, verdict: "Likely duplicate", rationale: "Same navigation and credentials." }], dupeGroup: 0 }],
      groups: [{ survivorId: "candidate-1", averageSimilarity: 92, reason: "Same setup task.", members: [{ id: "candidate-1", title: "VPN setup", stat: "New", retained: true }, { id: "123456789012345", title: "VPN configuration", stat: "12 views", retained: false }] }],
      decisions: { selectedKeys: ["candidate-1"], resolutions: ["merged"] },
    } as unknown as StoredRun;
    const execution = { plan: [{ idempotencyKey: "draft-1", kind: "revise", candidateKey: "candidate-1", solutionId: "123456789012345", fromMerge: true, mergeSources: [{ id: "123456789012346", title: "VPN legacy" }] }] } as ExecuteArgs;
    const output: PreparedContent = { version: "draft-v1", title: "VPN", summary: "", keywords: [], templateName: "How To (RA)", fields: [], warnings: [] };
    const dimensions = buildEvaluationDimensions(run, execution, "draft-1", output);
    expect(dimensions).toHaveLength(1);
    expect(dimensions[0].descriptor.dimension).toBe("deduplication");
    expect(dimensions[0].descriptor.action).toBe("Find duplicates");
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

  it("excludes not-applicable criteria from the weighted score", () => {
    const judgment: EvaluationJudgment = { summary: "Measured.", criteria: [
      { criterionId: "factual_grounding", score: 4, verdict: "met", explanation: "Supported.", evidence: ["Source"] },
      { criterionId: "structure", score: 4, verdict: "met", explanation: "Structured.", evidence: ["Field"] },
      { criterionId: "standards", score: null, verdict: "not_applicable", explanation: "The draft contains no material governed by this conditional rule.", evidence: [] },
      { criterionId: "usefulness", score: null, verdict: "not_applicable", explanation: "The draft contains no material governed by this conditional rule.", evidence: [] },
    ] };
    expect(scoreJudgment(rubric, judgment)).toBe(100);
  });
});
