/**
 * Focused probe into manageSolution write semantics, after the Phase 1 spike showed
 * status changes being silently ignored and an in-place update returning a NEW id.
 *
 * Answers:
 *   Q1  Does the `status` parameter do anything?
 *   Q2  Does solutionID update in place, or create a new record?
 *   Q3  What does revisionParentID actually produce?
 *
 * Run: npm run probe
 */
import "dotenv/config";
import { ra } from "../lib/ra/client";

const TAG = "ZZ-KS-PROBE";

function h(t: string) {
  console.log(`\n${"-".repeat(72)}\n${t}\n${"-".repeat(72)}`);
}
const idOf = (raw: string) => (String(raw).match(/(\d{15})/)?.[1] ?? "");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Newly written solutions are not immediately readable; poll before asserting. */
async function waitFor(id: string, tries = 12) {
  for (let i = 0; i < tries; i++) {
    try {
      return await ra.getSolution(id);
    } catch {
      await sleep(1000);
    }
  }
  throw new Error(`solution ${id} never became readable`);
}

async function snapshot(id: string, label: string) {
  const s = await waitFor(id);
  const first = s.fields?.[0];
  console.log(
    `  ${label}: id=${s.id} status="${s.status}" title="${s.title}" revisionID=${s.revisionID} ${first?.name}="${(first?.content ?? "").slice(0, 40)}"`,
  );
  return s;
}

async function main() {
  const templates = await ra.getTemplates();
  const tpl = templates.find((t) => t.templateName === "How To (RA)")!;
  const collections = await ra.getCollections();

  h("SETUP  create a fresh solution");
  const created = await ra.manageSolution({
    title: `${TAG} base`,
    language: "English",
    templateName: tpl.templateName,
    status: "draft",
    collections: collections[0]?.code,
    fields: [{ fieldName: "Solution", fieldValue: "BASE CONTENT" }],
  });
  const id = idOf(created);
  console.log(`  raw: ${created}`);
  await snapshot(id, "after create");

  h("Q1  status parameter: draft -> approved");
  const r1 = await ra.manageSolution({
    solutionID: id,
    templateName: tpl.templateName,
    status: "approved",
  });
  console.log(`  raw: ${r1}`);
  const afterApprove = await snapshot(id, "after status=approved");
  console.log(
    `  => status param ${afterApprove.status === "Draft" ? "IGNORED (still Draft)" : "APPLIED"}`,
  );

  h("Q1b  status=approved WITH title (does it need a full payload?)");
  const r1b = await ra.manageSolution({
    solutionID: id,
    templateName: tpl.templateName,
    title: `${TAG} base`,
    status: "approved",
    collections: collections[0]?.code,
    fields: [{ fieldName: "Solution", fieldValue: "BASE CONTENT" }],
  });
  console.log(`  raw: ${r1b}`);
  await snapshot(id, "after full-payload approve");

  h("Q2  solutionID update: in place, or new record?");
  const r2 = await ra.manageSolution({
    solutionID: id,
    templateName: tpl.templateName,
    title: `${TAG} EDITED`,
    minorSave: true,
    fields: [{ fieldName: "Solution", fieldValue: "EDITED CONTENT" }],
  });
  console.log(`  raw: ${r2}`);
  const newId = idOf(r2);
  console.log(`  returned id === original id ? ${newId === id}  (${newId} vs ${id})`);
  await snapshot(id, "original after update");
  if (newId && newId !== id) await snapshot(newId, "returned id");

  h("Q3  revisionParentID");
  const r3 = await ra.manageSolution({
    revisionParentID: id,
    templateName: tpl.templateName,
    title: `${TAG} REVISION`,
    collections: collections[0]?.code,
    fields: [{ fieldName: "Solution", fieldValue: "REVISION CONTENT" }],
  });
  console.log(`  raw: ${r3}`);
  const revId = idOf(r3);
  await snapshot(id, "parent after revision");
  if (revId && revId !== id) await snapshot(revId, "revision record");

  h("CLEANUP ids to remove manually");
  console.log(`  ${[id, newId, revId].filter(Boolean).join("  ")}`);
}

main().catch((e) => {
  console.error("PROBE ERROR:", e);
  process.exit(1);
});
