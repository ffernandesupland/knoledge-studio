import type { DecisionSnapshot } from "../db/runs";
import { buildWritePlan } from "../pipeline/submit";

/** In guided mode unchecking a source intentionally excludes it, including from merges.
 * Autonomous decisions must not confuse exclusion with "do not create separately". */
export function unselectedMergeGroups(snapshot: DecisionSnapshot) {
  return snapshot.groups.flatMap((group, index) => snapshot.resolutions[index] === "merged" && !group.members.some(member => snapshot.selectedKeys.includes(member.id)) ? [index] : []);
}

export function autonomousWritePlan(runId: string, snapshot: DecisionSnapshot) {
  const missing = unselectedMergeGroups(snapshot);
  if (missing.length) throw new Error(`Merge groups ${missing.join(", ")} exclude every source proposal. keep=true means include this proposal's content, INCLUDING as a merge contribution, not create it separately. Set keep=true for supported contributing proposals, or choose separate if the whole group is intentionally excluded.`);
  const plan = buildWritePlan({ runId, candidates: snapshot.candidates, groups: snapshot.groups, selected: new Set(snapshot.selectedKeys), resolutions: snapshot.resolutions });
  snapshot.groups.forEach((group, index) => {
    if (snapshot.resolutions[index] === "merged" && !plan.some(op => op.kind !== "flag" && op.candidateKey === group.survivorId && op.mergeSources?.length)) throw new Error(`Merge group ${index} does not produce a merge operation. Include its retained proposal and at least one contributing source, or choose separate.`);
  });
  return plan;
}
