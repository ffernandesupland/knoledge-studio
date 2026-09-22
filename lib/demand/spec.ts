import type { ReviewObjective } from "../ks/solution-reviews";

export const DEMAND_STAGES = ["plan", "author", "merge", "standards", "quality"] as const;
export type DemandStage = (typeof DEMAND_STAGES)[number];

export type DirectivePriority = "required" | "preferred";

/**
 * A server-authorized instruction that can narrow content scope or presentation, but never
 * grants a model a new action, fact source, or write permission.
 */
export interface ScopedDirective {
  id: string;
  source: "operator" | "review";
  text: string;
  priority: DirectivePriority;
  appliesTo: DemandStage[];
}

/** The immutable, user-authored brief saved with a pipeline run. */
export interface DemandSpecification {
  version: 1;
  intent: string;
  directives: Array<Omit<ScopedDirective, "source">>;
}

export const emptyDemandSpecification = (): DemandSpecification => ({ version: 1, intent: "", directives: [] });

export function hasDemandRequirements(spec?: DemandSpecification): boolean {
  return !!spec && (!!spec.intent.trim() || spec.directives.some((directive) => directive.text.trim()));
}

export function demandDirectives(spec?: DemandSpecification): ScopedDirective[] {
  if (!spec) return [];
  const intent = spec.intent.trim();
  return [
    ...(intent ? [{ id: "operator-intent", source: "operator" as const, text: intent, priority: "required" as const, appliesTo: ["plan", "author", "merge", "quality"] as DemandStage[] }] : []),
    ...spec.directives.filter((directive) => directive.text.trim()).map((directive) => ({ ...directive, text: directive.text.trim(), source: "operator" as const })),
  ];
}

export function reviewDirectives(objectives: ReviewObjective[] = []): ScopedDirective[] {
  return objectives.map((objective) => ({
    id: `review:${objective.key}`,
    source: "review",
    text: objective.resolution ? `${objective.instruction}\nAuthor-confirmed final information: ${objective.resolution.finalInformation}` : objective.instruction,
    priority: "required",
    appliesTo: objective.nativeOperation === "Apply content standards" ? ["plan", "author", "merge", "standards", "quality"] : ["plan", "author", "merge", "quality"],
  }));
}

export function applicableDirectives(directives: ScopedDirective[], stage: DemandStage): ScopedDirective[] {
  return directives.filter((directive) => directive.appliesTo.includes(stage));
}
