import type { ConfigurationResolutionTarget, Snippet } from "./types";
import { taxonomyMatches } from "./resolver";

const normalized = (value: string | undefined) => value?.trim().toLocaleLowerCase() || undefined;

/**
 * Snippets compose: global entries are available everywhere and scoped entries
 * are added when their scope matches the final article metadata. Unlike standards,
 * they are reusable building blocks rather than mutually exclusive policies.
 */
export function snippetsForTarget(snippets: Snippet[], target: ConfigurationResolutionTarget): Snippet[] {
  const collections = new Set((target.collections ?? []).map(normalized).filter((value): value is string => !!value));
  const taxonomies = target.taxonomies ?? [];
  return snippets.filter((snippet) => {
    if (!snippet.active) return false;
    const collection = normalized(snippet.scope.collection);
    const taxonomy = snippet.scope.taxonomy;
    return (!collection || collections.has(collection)) && (!taxonomy || taxonomies.some(value => taxonomyMatches(taxonomy, value)));
  });
}
