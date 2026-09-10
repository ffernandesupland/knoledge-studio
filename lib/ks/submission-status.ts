import type { WriteOp } from "../pipeline/submit";
import type { OpResult } from "../pipeline/execute";

/** Completion follows every planned operation, including tracking comments. */
export function submissionStatus(plan: WriteOp[], results: OpResult[]) {
  const latest = new Map(results.map((r) => [r.idempotencyKey, r]));
  const articles = plan.filter((op) => op.kind !== "flag");
  const comments = plan.filter((op) => op.kind === "flag");
  const saved = (ops: WriteOp[]) => ops.filter((op) => latest.get(op.idempotencyKey)?.outcome === "ok").length;
  const articlesSaved = saved(articles), commentsSaved = saved(comments);
  const pendingArticles = articles.length - articlesSaved, pendingComments = comments.length - commentsSaved;
  const uncertain = plan.filter((op) => latest.get(op.idempotencyKey)?.outcome === "uncertain").length;
  const complete = plan.length > 0 && pendingArticles + pendingComments === 0;
  return { articlesSaved, commentsSaved, pendingArticles, pendingComments, uncertain, complete,
    message: `${articlesSaved} of ${articles.length} articles submitted · ${commentsSaved} of ${comments.length} tracking comments saved.`,
    submitLabel: uncertain ? "Verify pending writes" : !pendingArticles && pendingComments ? "Retry pending comments" : articlesSaved ? "Submit remaining drafts" : "Submit reviewed drafts",
  };
}
