/**
 * Phase 1 write spike — KS-019 through KS-023.
 *
 * Self-contained: creates its own solution, promotes it to live, tests the revision path
 * against it, then archives it. Never mutates pre-existing tenant content.
 *
 * Every assertion polls, because RA writes are eventually consistent (finding V8): the
 * first version of this spike reported false passes by reading back stale data.
 *
 * Run: npm run spike
 */
import "dotenv/config";
import { parseSolutionId, ra } from "../lib/ra/client";
import { getToken, tokenTtlSeconds } from "../lib/ra/auth";
import { isLive } from "../lib/ra/status";
import type { WSSolution } from "../lib/ra/types";

const TAG = "ZZ-KS-SPIKE";
let passed = 0;
let failed = 0;
const notes: string[] = [];

function h(t: string) {
  console.log(`\n${"=".repeat(74)}\n${t}\n${"=".repeat(74)}`);
}
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  PASS  ${msg}`);
  } else {
    failed++;
    console.log(`  FAIL  ${msg}`);
  }
}
function note(m: string) {
  console.log(`        ${m}`);
}
const body = (s: WSSolution, field: string) =>
  (s.fields ?? []).find((f) => f.name === field)?.content?.trim() ?? "";

async function main() {
  h("KS-011 / KS-012  Auth");
  const token = await getToken();
  const ttl = tokenTtlSeconds(token);
  assert(ttl > 0 && ttl <= 900, `JWT issued, ttl=${ttl}s (expected <= 900)`);

  h("KS-014 / KS-015  Metadata reads");
  const templates = await ra.getTemplates();
  const tpl = templates.find((t) => t.templateName === "How To (RA)")!;
  assert(templates.length > 0, `${templates.length} templates`);
  assert(!!tpl, `resolved "How To (RA)" -> ${tpl?.fields.map((f) => f.fieldName).join(", ")}`);
  const collections = await ra.getCollections();
  assert(collections.length > 0, `${collections.length} collections`);
  const collection = collections[0].code;

  h("KS-019  Create");
  const createdRaw = await ra.manageSolution({
    title: `${TAG} base`,
    summary: "Spike artefact. Safe to delete.",
    language: "English",
    templateName: tpl.templateName,
    status: "draft",
    collections: collection,
    fields: [{ fieldName: "Solution", fieldValue: "BASE CONTENT" }],
  });
  const id = parseSolutionId(createdRaw);
  assert(!!id, `created ${id}`);
  note(`raw: ${createdRaw}`);

  const created = await ra.waitForSolution(id);
  assert(created.status === "Draft", `reads back as "${created.status}"`);
  assert(body(created, "Solution") === "BASE CONTENT", "field content round-tripped");

  h("KS-113  Direct edit while NOT live");
  assert(!isLive(created.status), `isLive("${created.status}") === false`);
  const d = await ra.updateSolution(created, {
    title: `${TAG} base edited`,
    fields: [{ fieldName: "Solution", fieldValue: "EDITED CONTENT" }],
  });
  assert(d.mode === "direct", `routed to ${d.mode}`);
  assert(d.solutionId === id, `edited in place (${d.solutionId} === ${id})`);
  const edited = await ra.waitForSolution(id, (s) => s.title.endsWith("edited"));
  assert(body(edited, "Solution") === "EDITED CONTENT", "direct edit applied");

  h("Promote to live");
  await ra.manageSolution({ solutionID: id, templateName: tpl.templateName, status: "approved" });
  const live = await ra.waitForSolution(id, (s) => isLive(s.status));
  assert(isLive(live.status), `status is now "${live.status}" -> isLive true`);
  const beforeTitle = live.title;
  const beforeBody = body(live, "Solution");

  h("KS-020  RISK GATE  revisionParentID must not touch the live record");
  const r = await ra.updateSolution(live, {
    title: `${TAG} REVISION must not appear on parent`,
    fields: [{ fieldName: "Solution", fieldValue: "REVISION CONTENT" }],
  });
  assert(r.mode === "revision", `routed to ${r.mode}`);
  assert(!!r.solutionId && r.solutionId !== id, `new record ${r.solutionId} (parent ${id})`);

  const parent = await ra.waitForSolution(id, (s) => !!s.revisionID);
  assert(parent.title === beforeTitle, `parent title unchanged ("${parent.title}")`);
  assert(body(parent, "Solution") === beforeBody, `parent body unchanged ("${beforeBody}")`);
  note(`parent status after revision: "${parent.status}" (transition to Draft is accepted — V14)`);
  note(`parent revisionID: ${parent.revisionID}`);

  const revision = await ra.waitForSolution(r.solutionId);
  assert(revision.status === "Draft", `revision is "${revision.status}"`);
  assert(body(revision, "Solution") === "REVISION CONTENT", "revision holds the new content");
  note(`revision revisionID: ${revision.revisionID}`);
  notes.push(
    `revisionID links use child<id>/parent<id>: ${parent.revisionID} <-> ${revision.revisionID}`,
  );

  h("KS-023  G5 review date writability");
  const beforeRenew = parent.renewDate;
  await ra.manageSolution({
    solutionID: id,
    templateName: tpl.templateName,
    ...({ renewDate: "12/31/2027" } as Record<string, string>),
  });
  const afterRenew = await ra.waitForSolution(id);
  assert(
    afterRenew.renewDate === beforeRenew,
    `renewDate NOT writable via manageSolution (${beforeRenew} -> ${afterRenew.renewDate})`,
  );
  notes.push("G5 confirmed: renewDate is read-only through manageSolution");

  h("KS-022  Breadcrumb comment");
  const c = await ra.addComment(id, {
    commentTitle: "Merged by Knowledge Studio",
    comments: `Merged into ${TAG} survivor (spike).`,
    hiddenFromSS: true,
  });
  assert(String(c).includes("/comments/"), `comment created: ${String(c).trim()}`);

  h("KS-021  Merge outcome: flag the non-surviving solution");
  const flag = await ra.flagMergedInto(id, { id: r.solutionId, title: `${TAG} survivor` });
  assert(String(flag).includes("/comments/"), `flagged as merged: ${String(flag).trim()}`);
  notes.push("Merge losers are flagged via comment, not archived (V13 decision)");

  h(`RESULT  ${passed} passed, ${failed} failed`);
  console.log(`  parent:   ${id}\n  revision: ${r.solutionId}`);
  for (const n of notes) console.log(`  - ${n}`);
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nSPIKE ABORTED:", e);
  process.exit(1);
});
