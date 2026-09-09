import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { buildSubmissionGraph } from "./submission-graph";
import { SubmissionGraph } from "../../components/ks/SubmissionGraph";
import type { WriteOp } from "../pipeline/submit";
const merge: WriteOp = { kind: "revise", solutionId: "260909000000001", candidateKey: "260909000000001", title: "External retained article", fromMerge: true, mergeSources: [{ id: "c0", title: "First proposal", rawContent: "First source" }, { id: "c1", title: "Second proposal", rawContent: "Second source" }, { id: "260909000000002", title: "Existing source" }], idempotencyKey: "merge" };
const comment: WriteOp = { kind: "flag", solutionId: "260909000000002", survivorKey: merge.candidateKey, survivorLabel: merge.title, idempotencyKey: "comment" };
describe("submission graph from write operations", () => {
  it("counts a many-to-one merge as one output and includes the external retained article", () => {
    const graph = buildSubmissionGraph([merge, comment]);
    expect(graph.counts).toEqual({ created: 0, revised: 1, merged: 1, comments: 1 });
    expect(graph.rows[0].sources).toHaveLength(4);
    expect(graph.rows[0].sources[0]).toMatchObject({ id: merge.solutionId, retained: true, existing: true });
    expect(graph.rows[0].comments.map((c) => c.sourceId)).toEqual([comment.solutionId]);
  });
  it("keeps completed merges separate from failed comment outcomes", () => {
    const graph = buildSubmissionGraph([merge, comment], [], [{ kind: "revise", description: "Merged", idempotencyKey: "merge", outcome: "ok" }, { kind: "flag", description: "Comment", idempotencyKey: "comment", outcome: "error" }]);
    expect(graph.rows[0].result!.outcome).toBe("ok"); expect(graph.rows[0].comments[0].result!.outcome).toBe("error");
  });
  it("renders all sources and the external result as accessible selectable nodes", () => {
    const html = renderToStaticMarkup(createElement(SubmissionGraph, { model: buildSubmissionGraph([merge, comment]) }));
    expect(html).toContain("External retained article"); expect(html).toContain("Second proposal"); expect(html).toContain("Tracking comment"); expect(html).toContain('aria-pressed='); expect(html).toContain("Planned result");
  });
});
