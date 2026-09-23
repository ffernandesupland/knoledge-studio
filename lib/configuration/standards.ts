import { resolveConfigurationProfile } from "./resolver";
import type { CapturedConfigurationSnapshot } from "./snapshots";
import type { WriteOp } from "../pipeline/submit";

/** Resolves the frozen standards catalog against each article's final metadata. */
export function standardsForPlan(snapshot: CapturedConfigurationSnapshot | undefined, plan: WriteOp[], fallback: string[], defaultTarget: { collections?: string[]; taxonomies?: string[] } = {}): Record<string, string[]> {
  const resolved: Record<string, string[]> = {};
  if (!snapshot) return resolved;
  for (const operation of plan) {
    if (operation.kind === "flag") continue;
    const match = resolveConfigurationProfile(snapshot.profiles, {
      collections: operation.metadata?.collections ?? defaultTarget.collections,
      taxonomies: operation.metadata?.taxonomies ?? defaultTarget.taxonomies,
    });
    resolved[operation.candidateKey] = match
      ? match.profile.sources.map(source => `[${match.profile.name} · ${source.label}]\n${source.content}`)
      : fallback;
  }
  return resolved;
}
