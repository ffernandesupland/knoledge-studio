export const METADATA_OPERATION = "Discover and suggest metadata";
export interface MetadataValues { collections?: string[]; taxonomies?: string[]; language?: string }
export interface MetadataSettings { global?: MetadataValues; solutions?: Record<string, MetadataValues> }
export function effectiveMetadata(settings: MetadataSettings | undefined, key: string): MetadataValues | undefined {
  const value = { ...settings?.global, ...settings?.solutions?.[key] };
  return Object.keys(value).length ? value : undefined;
}
