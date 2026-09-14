import type { MetadataReport } from "../metadata/types";
import type { MetadataValues } from "../metadata/settings";
import type { AutonomousInput } from "./types";

/** Apply only supported controlled values; abstention preserves the existing destination. */
export function autonomousMetadataValues(report: Pick<MetadataReport, "suggestions">, input: Pick<AutonomousInput, "collection" | "language">): MetadataValues {
  const collections = [...new Set(report.suggestions.filter(s => s.option.kind === "collection").map(s => s.option.value))];
  const taxonomies = [...new Set(report.suggestions.filter(s => s.option.kind === "taxonomy").map(s => s.option.value))];
  return {
    ...(input.collection ? { collections: [input.collection] } : collections.length ? { collections } : {}),
    ...(taxonomies.length ? { taxonomies } : {}),
    ...(input.language ? { language: input.language } : {}),
  };
}
