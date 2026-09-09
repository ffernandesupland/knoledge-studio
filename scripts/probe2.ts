/**
 * Probe 2 — the two anomalies left by the corrected spike:
 *   A  A solutionID update on a DRAFT returned a NEW id (possible silent record fork).
 *   B  status=archived appeared to be ignored, while status=approved applied.
 *
 * Run: npm run probe2
 */
import "dotenv/config";
import { parseSolutionId, ra } from "../lib/ra/client";

const TAG = "ZZ-KS-P2";

function h(t: string) {
  console.log(`\n${"-".repeat(72)}\n${t}\n${"-".repeat(72)}`);
}

async function makeDraft(tplName: string, collection: string) {
  const raw = await ra.manageSolution({
    title: `${TAG} base`,
    language: "English",
    templateName: tplName,
    status: "draft",
    collections: collection,
    fields: [{ fieldName: "Solution", fieldValue: "BASE" }],
  });
  const id = parseSolutionId(raw);
  await ra.waitForSolution(id);
  return id;
}

async function main() {
  const templates = await ra.getTemplates();
  const tpl = templates.find((t) => t.templateName === "How To (RA)")!;
  const collection = (await ra.getCollections())[0].code;

  h("A1  update a DRAFT with solutionID, minimal payload");
  const a1 = await makeDraft(tpl.templateName, collection);
  const r1 = await ra.manageSolution({
    solutionID: a1,
    templateName: tpl.templateName,
    title: `${TAG} A1 edited`,
    minorSave: true,
    fields: [{ fieldName: "Solution", fieldValue: "A1 EDITED" }],
  });
  console.log(`  base=${a1}\n  raw: ${r1}\n  same id? ${parseSolutionId(r1) === a1}`);

  h("A2  same, but WITH collections in the update payload");
  const a2 = await makeDraft(tpl.templateName, collection);
  const r2 = await ra.manageSolution({
    solutionID: a2,
    templateName: tpl.templateName,
    title: `${TAG} A2 edited`,
    collections: collection,
    minorSave: true,
    fields: [{ fieldName: "Solution", fieldValue: "A2 EDITED" }],
  });
  console.log(`  base=${a2}\n  raw: ${r2}\n  same id? ${parseSolutionId(r2) === a2}`);

  h("A3  same, WITHOUT minorSave");
  const a3 = await makeDraft(tpl.templateName, collection);
  const r3 = await ra.manageSolution({
    solutionID: a3,
    templateName: tpl.templateName,
    title: `${TAG} A3 edited`,
    collections: collection,
    fields: [{ fieldName: "Solution", fieldValue: "A3 EDITED" }],
  });
  console.log(`  base=${a3}\n  raw: ${r3}\n  same id? ${parseSolutionId(r3) === a3}`);

  h("B  archive transitions");
  const b = await makeDraft(tpl.templateName, collection);

  const bDraftArchive = await ra.manageSolution({
    solutionID: b,
    templateName: tpl.templateName,
    status: "archived",
  });
  console.log(`  archive-from-draft raw: ${bDraftArchive}`);
  const afterDraftArchive = await ra.waitForSolution(b, (s) => s.status !== "Draft", { tries: 6 });
  console.log(`  status after archive-from-draft: "${afterDraftArchive.status}"`);

  await ra.manageSolution({ solutionID: b, templateName: tpl.templateName, status: "approved" });
  const pub = await ra.waitForSolution(b, (s) => s.status === "Published", { tries: 10 });
  console.log(`  promoted to: "${pub.status}"`);

  const bPubArchive = await ra.manageSolution({
    solutionID: b,
    templateName: tpl.templateName,
    status: "archived",
  });
  console.log(`  archive-from-published raw: ${bPubArchive}`);
  const afterPubArchive = await ra.waitForSolution(b, (s) => s.status !== "Published", {
    tries: 10,
  });
  console.log(`  status after archive-from-published: "${afterPubArchive.status}"`);

  h("CLEANUP ids");
  console.log(`  ${[a1, a2, a3, b].join("  ")}`);
}

main().catch((e) => {
  console.error("PROBE2 ERROR:", e);
  process.exit(1);
});
