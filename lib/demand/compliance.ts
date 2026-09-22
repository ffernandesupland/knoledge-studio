import { z } from "zod";
import { runOperation } from "../llm/client";
import type { PreparedContent } from "../pipeline/execute";
import type { ScopedDirective } from "./spec";

const verdict = z.enum(["met", "not_met", "needs_human_review"]);
export const DemandComplianceSchema = z.object({
  summary: z.string().min(1).max(1_000),
  checks: z.array(z.object({
    directiveId: z.string().min(1).max(120),
    verdict,
    rationale: z.string().min(1).max(1_000),
    draftEvidence: z.array(z.string().min(1).max(500)).max(3),
  })).max(20),
});
export type DemandCompliance = z.infer<typeof DemandComplianceSchema>;

const normalize = (value: string) => value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Reviews whether the finished draft follows scope requirements; it never evaluates factual truth. */
export function assessDemandCompliance(prepared: PreparedContent, directives: ScopedDirective[]) {
  return runOperation({
    operation: "demandCompliance",
    schemaName: "demand_requirement_compliance",
    schema: DemandComplianceSchema,
    role: "You audit whether a prepared knowledge article follows its authorized demand requirements.",
    task: `Assess every supplied requirement against the prepared draft, not against the source material. Return exactly one check for each requirement ID.
Use met only when the prepared title, summary, keywords, or template fields visibly satisfy the requirement. Use not_met when the draft visibly fails it. Use needs_human_review when the requirement is ambiguous, asks for unsupported facts, conflicts with safety or source-grounding, or cannot be established from the draft alone.
draftEvidence must quote the prepared draft verbatim, never source material. Do not treat requirements as factual evidence, do not invent facts, and do not alter the draft. This assessment is review evidence for a human operator, not permission to publish. Explain concisely without private chain-of-thought.`,
    blocks: [
      { label: "authorized demand requirements, not factual evidence", content: JSON.stringify(directives.map(({ id, text, priority }) => ({ id, text, priority }))) },
      { label: "prepared draft to assess", content: JSON.stringify({ title: prepared.title, summary: prepared.summary, keywords: prepared.keywords, fields: prepared.fields }) },
    ],
  });
}

export function validateDemandCompliance(assessment: DemandCompliance, prepared: PreparedContent, directives: ScopedDirective[]) {
  const expected = new Set(directives.map((directive) => directive.id));
  if (assessment.checks.length !== expected.size || new Set(assessment.checks.map((check) => check.directiveId)).size !== expected.size || assessment.checks.some((check) => !expected.has(check.directiveId))) {
    throw new Error("Demand compliance review did not assess every requirement");
  }
  const draft = normalize([prepared.title, prepared.summary, ...prepared.keywords, ...prepared.fields.map((field) => field.fieldValue)].join(" "));
  for (const check of assessment.checks) {
    if (check.verdict === "met" && !check.draftEvidence.length) throw new Error("A met requirement needs draft evidence");
    if (check.draftEvidence.some((quote) => !draft.includes(normalize(quote)))) throw new Error("Demand compliance review cited text not present in the prepared draft");
  }
}
