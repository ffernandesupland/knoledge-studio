export const METADATA_OPERATION = "Discover and suggest metadata";
export interface MetadataValues { collections?: string[]; taxonomies?: string[]; language?: string }
export interface MetadataDecision { status: "accepted" | "rejected" | "deferred"; kind: "collection" | "taxonomy" | "attribute"; value: string; label: string; attributeName?: string; attributeSet?: string; sourceEvidence: string; researchIdentity: string }
export interface MetadataSettings { global?: MetadataValues; solutions?: Record<string, MetadataValues>; decisions?: Record<string, Record<string, MetadataDecision>> }
export function metadataDecisionKey(option: { kind: string; value: string; attributeName?: string; attributeSet?: string }) {
  return JSON.stringify([option.kind, option.attributeSet ?? "", option.attributeName ?? "", option.value]);
}
export function effectiveMetadata(settings: MetadataSettings | undefined, key: string): MetadataValues | undefined {
  const value = { ...settings?.global, ...settings?.solutions?.[key] };
  return Object.keys(value).length ? value : undefined;
}
