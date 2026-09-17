import type { WSSolution } from "../ra/types";
import type { GroundContextSnapshot } from "../ground-context/types";

export interface MetadataOption {
  id: string;
  kind: "collection" | "taxonomy" | "attribute";
  value: string;
  label: string;
  attributeName?: string;
  attributeSet?: string;
  origin: "catalog" | "observed";
}
export interface MetadataExample {
  id: string;
  title: string;
  summary: string;
  collections: string[];
  taxonomy: string[];
  attributes?: { name: string; values: string[] }[];
  attributeSet?: string;
}
export interface MetadataSuggestion {
  option: MetadataOption;
  reason: string;
  sourceEvidence: string;
  exampleIds: string[];
  alreadyAssigned: boolean;
  referenceEvidence?: { referenceId: string; quote: string }[];
  sourceFields?: string[];
}
export interface MetadataReport {
  identity?: string;
  planSourceKey?: string;
  groundContext?: GroundContextSnapshot;
  sources?: { id: string; title: string; body: string }[];
  solution: WSSolution;
  collectionLabels: Record<string, string>;
  generatedAt: string;
  rationale: string;
  suggestions: MetadataSuggestion[];
  uncertainties: string[];
  examples: MetadataExample[];
  queries: string[];
  coverage: { collections: number; taxonomyPaths: number; candidates: number; examples: number; browsedPaths: string[] };
  limitations: string[];
  usage: { inputTokens: number; outputTokens: number; costUsd: number };
}
