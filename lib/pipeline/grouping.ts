import type { DuplicateMatch } from "./dedupe";

export interface GroupMember {
  /** Solution ID for existing articles; the candidate key for new drafts. */
  id: string;
  title: string;
  isNew: boolean;
  viewCount: number;
}

export interface DuplicateGroup {
  members: GroupMember[];
  survivorId: string;
  averageSimilarity: number;
  rationales: string[];
  /** The operator explicitly selected these articles; this is not a duplicate-detection result. */
  manualSelection?: boolean;
}

class UnionFind {
  private parent = new Map<string, string>();

  find(x: string): string {
    const p = this.parent.get(x);
    if (p === undefined) {
      this.parent.set(x, x);
      return x;
    }
    if (p === x) return x;
    const root = this.find(p);
    this.parent.set(x, root);
    return root;
  }

  union(a: string, b: string): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export interface GroupingInput {
  candidates: { key: string; title: string; isNew?: boolean; viewCount?: number }[];
  /** Adjudicated matches per candidate key. */
  matchesByCandidate: Record<string, DuplicateMatch[]>;
  intraBatchPairs?: { sameUserNeed?: boolean; aIndex: number; bIndex: number; similarity: number; rationale: string }[];
  /**
   * Only links at or above this score group items together. Calibrated for the adjudicating
   * model: on the same fixture luna scores ~14 points higher than terra, so a threshold tuned
   * on one model will over- or under-merge on the other.
   */
  threshold?: number;
}

/**
 * Groups candidates and their matched solutions into merge sets, recommending the member with
 * the most views as the survivor. View counts are real (`verboseSolutionResult.viewCount`);
 * inbound-link counts are not available from the API and are deliberately not modelled.
 */
export function buildDuplicateGroups(input: GroupingInput): DuplicateGroup[] {
  const { candidates, matchesByCandidate, intraBatchPairs = [], threshold = 80 } = input;

  const uf = new UnionFind();
  const members = new Map<string, GroupMember>();
  const links: { a: string; b: string; similarity: number; rationale: string }[] = [];

  for (const c of candidates) {
    members.set(c.key, { id: c.key, title: c.title, isNew: c.isNew ?? true, viewCount: c.viewCount ?? 0 });
    uf.find(c.key);
  }

  for (const [key, matches] of Object.entries(matchesByCandidate)) {
    for (const m of matches) {
      if (m.sameUserNeed !== true || m.verdict === "distinct" || m.similarity < threshold) continue;
      members.set(m.solutionId, {
        id: m.solutionId,
        title: m.title,
        isNew: false,
        viewCount: m.viewCount,
      });
      uf.union(key, m.solutionId);
      links.push({ a: key, b: m.solutionId, similarity: m.similarity, rationale: m.rationale });
    }
  }

  for (const p of intraBatchPairs) {
    const a = candidates[p.aIndex];
    const b = candidates[p.bIndex];
    if (!a || !b || p.sameUserNeed !== true || p.similarity < threshold) continue;
    uf.union(a.key, b.key);
    links.push({ a: a.key, b: b.key, similarity: p.similarity, rationale: p.rationale });
  }

  const byRoot = new Map<string, GroupMember[]>();
  for (const m of members.values()) {
    const root = uf.find(m.id);
    const list = byRoot.get(root) ?? [];
    list.push(m);
    byRoot.set(root, list);
  }

  const groups: DuplicateGroup[] = [];
  for (const [root, groupMembers] of byRoot) {
    if (groupMembers.length < 2) continue;

    const ids = new Set(groupMembers.map((m) => m.id));
    const groupLinks = links.filter((l) => ids.has(l.a) && ids.has(l.b));
    const averageSimilarity = groupLinks.length
      ? Math.round(groupLinks.reduce((s, l) => s + l.similarity, 0) / groupLinks.length)
      : 0;

    // Prefer the most-viewed existing article; a brand-new draft only wins if nothing exists.
    const survivor = [...groupMembers].sort((a, b) => {
      if (a.isNew !== b.isNew) return a.isNew ? 1 : -1;
      return b.viewCount - a.viewCount;
    })[0];

    groups.push({
      members: groupMembers,
      survivorId: survivor.id,
      averageSimilarity,
      rationales: [...new Set(groupLinks.map((l) => l.rationale))],
    });
    void root;
  }

  return groups.sort((a, b) => b.averageSimilarity - a.averageSimilarity);
}
