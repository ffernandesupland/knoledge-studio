/**
 * Phase 9 write-path smoke test. Exercises buildWritePlan + executeWritePlan against the QA
 * tenant using its own artefacts only — it creates a solution, revises a solution this project
 * created earlier, and flags its own creation. It never touches pre-existing tenant content.
 *
 * Run: npm run submit-smoke
 */
import "dotenv/config";
import { buildWritePlan } from "../lib/pipeline/submit";
import { executeWritePlan } from "../lib/pipeline/execute";
import { ra } from "../lib/ra/client";
import { isLive } from "../lib/ra/status";
import type { ViewCandidate, ViewDupeGroup } from "../lib/ks/model";

/** Published artefact created by scripts/spike.ts. */
const SPIKE_PARENT = "260903133029283";

const runId = `smoke-${Date.now()}`;
let pass = 0;
let fail = 0;

function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++;
    console.log(`  PASS  ${msg}`);
  } else {
    fail++;
    console.log(`  FAIL  ${msg}`);
  }
}

const candidate = (over: Partial<ViewCandidate>): ViewCandidate => ({
  key: "c0",
  title: "ZZ-KS-SUBMIT new draft",
  subtitle: "",
  action: "New",
  source: "Your content",
  why: "",
  templateName: "How To (RA)",
  fields: [{ fieldName: "Solution", fieldValue: "1. Open settings. 2. Enable the option." }],
  rawContent: "Open settings. Enable the option.",
  duplicates: [],
  dupeGroup: null,
  ...over,
});

async function main() {
  const collection = (await ra.getCollections())[0].code;
  const parent = await ra.getSolution(SPIKE_PARENT);
  console.log(`parent ${SPIKE_PARENT} status="${parent.status}" isLive=${isLive(parent.status)}\n`);

  const candidates: ViewCandidate[] = [
    candidate({ key: "c0" }),
    candidate({
      key: SPIKE_PARENT,
      title: "ZZ-KS-SUBMIT revised via merge",
      action: "Merge",
      dupeGroup: 0,
    }),
  ];
  const groups: ViewDupeGroup[] = [
    {
      survivorId: SPIKE_PARENT,
      averageSimilarity: 90,
      reason: "Same topic.",
      members: [
        { id: SPIKE_PARENT, title: "Spike parent", stat: "0 views", retained: true },
        { id: "c0", title: "ZZ-KS-SUBMIT new draft", stat: "New solution", retained: false },
      ],
    },
  ];

  console.log("=== plan: merged, survivor is the existing article ===");
  const plan = buildWritePlan({
    runId,
    candidates,
    groups,
    selected: new Set(["c0", SPIKE_PARENT]),
    resolutions: ["merged"],
  });
  plan.forEach((op) => console.log(`  ${op.kind.padEnd(7)} ${JSON.stringify(op).slice(0, 110)}`));
  assert(plan.some((o) => o.kind === "revise"), "survivor gets a revise op");
  assert(!plan.some((o) => o.kind === "flag"), "losing draft is not flagged (never existed)");

  console.log("\n=== execute ===");
  const results = await executeWritePlan(
    { runId, user: "sauser", plan, collection, language: "English" },
    (p) => console.log(`  ... [${p.index + 1}/${p.total}] ${p.description}`),
  );
  results.forEach((r) =>
    console.log(`  ${r.outcome.padEnd(7)} ${r.description}${r.solutionId ? ` -> ${r.solutionId}` : ""}${r.message ? ` (${r.message})` : ""}`),
  );
  assert(results.every((r) => r.outcome === "ok"), "every write succeeded");

  console.log("\n=== verify live parent is untouched ===");
  const after = await ra.waitForSolution(SPIKE_PARENT, () => true, { tries: 6 });
  assert(after.title === parent.title, `parent title unchanged ("${after.title}")`);
  assert(
    (after.fields ?? []).find((f) => f.name === "Solution")?.content ===
      (parent.fields ?? []).find((f) => f.name === "Solution")?.content,
    "parent body unchanged",
  );
  console.log(`  parent revisionID: ${after.revisionID}`);

  console.log("\n=== plan: merged, survivor is the new draft ===");
  const plan2 = buildWritePlan({
    runId: `${runId}-b`,
    candidates,
    groups: [{ ...groups[0], survivorId: "c0", members: groups[0].members.map((m) => ({ ...m, retained: m.id === "c0" })) }],
    selected: new Set(["c0", SPIKE_PARENT]),
    resolutions: ["merged"],
  });
  plan2.forEach((op) => console.log(`  ${op.kind.padEnd(7)} ${JSON.stringify(op).slice(0, 110)}`));
  assert(plan2.some((o) => o.kind === "create"), "surviving draft gets a create op");
  assert(
    plan2.some((o) => o.kind === "flag" && o.solutionId === SPIKE_PARENT),
    "losing existing article gets a flag op",
  );
  assert(
    plan2.findIndex((o) => o.kind === "flag") === plan2.length - 1,
    "flag runs last",
  );

  const results2 = await executeWritePlan(
    { runId: `${runId}-b`, user: "sauser", plan: plan2, collection, language: "English" },
    (p) => console.log(`  ... [${p.index + 1}/${p.total}] ${p.description}`),
  );
  results2.forEach((r) =>
    console.log(`  ${r.outcome.padEnd(7)} ${r.description}${r.solutionId ? ` -> ${r.solutionId}` : ""}${r.message ? ` (${r.message})` : ""}`),
  );
  assert(results2.every((r) => r.outcome === "ok"), "every write in the second plan succeeded");

  console.log(`\nRESULT  ${pass} passed, ${fail} failed`);
  if (fail) process.exitCode = 1;
}

main().catch((e) => {
  console.error("\nSUBMIT SMOKE ERROR:", e);
  process.exit(1);
});
