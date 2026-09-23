import type { ConfigurationProfile, ConfigurationResolutionTarget, ConfigurationScope } from "./types";

type ResolvableConfigurationProfile = Pick<ConfigurationProfile, "id" | "kind" | "scope" | "isDefault" | "status">;

export type ResolutionReason = "collection-and-taxonomy" | "taxonomy" | "collection" | "company-default";

export interface ResolvedConfigurationProfile<T extends ResolvableConfigurationProfile = ConfigurationProfile> {
  profile: T;
  reason: ResolutionReason;
  matchedTaxonomy?: string;
}

export class ConfigurationResolutionConflictError extends Error {
  constructor(public profileIds: string[]) {
    super(`Configuration profiles are equally specific for this target: ${profileIds.join(", ")}. Resolve the duplicate scope before continuing.`);
    this.name = "ConfigurationResolutionConflictError";
  }
}

function normalized(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLocaleLowerCase() : undefined;
}

function normalizedValues(values: string[]): string[] {
  return [...new Set(values.map(normalized).filter((value): value is string => !!value))].sort();
}

function taxonomyDepth(taxonomy: string): number {
  return taxonomy.split("//").filter(Boolean).length;
}

/** A taxonomy profile applies to its exact path and every descendant path. */
export function taxonomyMatches(profileTaxonomy: string, targetTaxonomy: string): boolean {
  const profile = normalized(profileTaxonomy);
  const target = normalized(targetTaxonomy);
  return !!profile && !!target && (target === profile || target.startsWith(`${profile}//`));
}

/** Canonical key used by persistence validation to prevent duplicate active scopes. */
export function configurationScopeKey(scope: ConfigurationScope, isDefault: boolean): string {
  if (isDefault) return "default";
  return JSON.stringify({ collections: normalizedValues(scope.collections), taxonomies: normalizedValues(scope.taxonomies), operator: scope.operator });
}

export function findScopeConflicts(profiles: ConfigurationProfile[], candidate: Pick<ConfigurationProfile, "id" | "kind" | "scope" | "isDefault" | "status">): ConfigurationProfile[] {
  if (candidate.status !== "active") return [];
  const key = configurationScopeKey(candidate.scope, candidate.isDefault);
  return profiles.filter((profile) => profile.id !== candidate.id && profile.status === "active" && profile.kind === candidate.kind && configurationScopeKey(profile.scope, profile.isDefault) === key);
}

interface Candidate<T extends ResolvableConfigurationProfile> {
  profile: T;
  reason: ResolutionReason;
  score: number;
  matchedTaxonomy?: string;
}

function resolveCandidate<T extends ResolvableConfigurationProfile>(profile: T, target: ConfigurationResolutionTarget): Candidate<T> | undefined {
  if (profile.status !== "active") return undefined;
  const profileCollections = normalizedValues(profile.scope.collections);
  const profileTaxonomies = normalizedValues(profile.scope.taxonomies);
  const collections = (target.collections ?? []).map(normalized).filter((value): value is string => !!value);
  const taxonomies = target.taxonomies ?? [];
  const collectionMatches = profileCollections.some(collection => collections.includes(collection));
  const matchedTaxonomies = profileTaxonomies.flatMap(taxonomy => taxonomies.filter(value => taxonomyMatches(taxonomy, value)).map(value => ({ profileTaxonomy: taxonomy, targetTaxonomy: value })));
  const matchedTaxonomy = matchedTaxonomies.sort((a, b) => taxonomyDepth(b.profileTaxonomy) - taxonomyDepth(a.profileTaxonomy))[0];
  const hasCollections = profileCollections.length > 0;
  const hasTaxonomies = profileTaxonomies.length > 0;
  const populatedDimensions = Number(hasCollections) + Number(hasTaxonomies);
  const matches = profile.scope.operator === "and"
    ? (!hasCollections || collectionMatches) && (!hasTaxonomies || !!matchedTaxonomy)
    : collectionMatches || !!matchedTaxonomy;

  if (populatedDimensions && matches) {
    const reason: ResolutionReason = populatedDimensions === 2 && collectionMatches && matchedTaxonomy ? "collection-and-taxonomy" : matchedTaxonomy ? "taxonomy" : "collection";
    const score = populatedDimensions === 2 && collectionMatches && matchedTaxonomy ? 40_000 + taxonomyDepth(matchedTaxonomy.profileTaxonomy)
      : matchedTaxonomy ? 30_000 + taxonomyDepth(matchedTaxonomy.profileTaxonomy)
        : 20_000;
    return { profile, reason, score, ...(matchedTaxonomy ? { matchedTaxonomy: matchedTaxonomy.targetTaxonomy } : {}) };
  }
  if (!hasCollections && !hasTaxonomies && profile.isDefault) return { profile, reason: "company-default", score: 10_000 };
  return undefined;
}

/**
 * Resolves exactly one active profile. A specific profile replaces the company default;
 * profiles are never silently merged because that would make authored rules non-deterministic.
 */
export function resolveConfigurationProfile<T extends ResolvableConfigurationProfile>(profiles: T[], target: ConfigurationResolutionTarget): ResolvedConfigurationProfile<T> | undefined {
  const candidates = profiles.map((profile) => resolveCandidate(profile, target)).filter((value): value is Candidate<T> => !!value);
  if (!candidates.length) return undefined;
  const highestScore = Math.max(...candidates.map((candidate) => candidate.score));
  const winners = candidates.filter((candidate) => candidate.score === highestScore);
  if (winners.length > 1) throw new ConfigurationResolutionConflictError(winners.map((candidate) => candidate.profile.id));
  const winner = winners[0];
  return { profile: winner.profile, reason: winner.reason, ...(winner.matchedTaxonomy ? { matchedTaxonomy: winner.matchedTaxonomy } : {}) };
}
