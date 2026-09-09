/**
 * End-to-end pipeline smoke test against the QA tenant. Read-only: produces a plan, writes
 * nothing back to the knowledge base.
 *
 * Requires OPENAI_API_KEY in .env.
 *
 * Run: npm run pipeline
 */
import "dotenv/config";
import { runPipeline, type OperationName } from "../lib/pipeline/run";

const SAMPLE = `Connecting to the corporate VPN.

On Windows 11, after the Q2 security update some users cannot establish a VPN connection.
The machine certificate issued by the internal CA expires after 90 days; renew it from the
company portal, update the VPN client to build 9.4 or later, then reconnect.

Common error codes: 809 means the certificate expired. 691 means the SSO token lapsed.
720 means the client build is outdated.

On macOS the VPN drops local network access. Enable split tunnelling in the client's advanced
settings so only corporate traffic routes through the tunnel.`;

const OPERATIONS: OperationName[] = [
  "Split topics",
  "Restructure content",
  "Apply content standards",
  "Find duplicates",
];

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error("OPENAI_API_KEY is not set in .env — nothing to run.");
    process.exit(1);
  }

  console.log(`Running pipeline: ${OPERATIONS.join(", ")}\n`);
  const t0 = Date.now();

  const result = await runPipeline(
    {
      text: SAMPLE,
      operations: OPERATIONS,
      // templateName omitted: let the pipeline pick per topic.
    },
    (e) => {
      if (e.status === "start") process.stdout.write(`  ... ${e.step}\n`);
    },
  );

  console.log(`\n${"=".repeat(74)}\nPLAN: ${result.solutions.length} solutions\n${"=".repeat(74)}`);
  for (const s of result.solutions) {
    console.log(`\n▸ ${s.title}   [${s.source}] [${s.templateName}]`);
    console.log(`  why: ${s.rationale}`);
    if (s.keywords.length) console.log(`  keywords: ${s.keywords.join(", ")}`);
    for (const f of s.fields) {
      const v = f.fieldValue.replace(/\s+/g, " ").trim();
      console.log(`  ${f.fieldName}: ${v.slice(0, 120)}${v.length > 120 ? "…" : ""}`);
    }
    for (const d of s.duplicates) {
      console.log(`  dup ${d.similarity}% ${d.verdict}  ${d.title} (${d.solutionId})`);
      console.log(`      ${d.rationale}`);
    }
  }

  if (result.groups.length) {
    console.log(`\n${"=".repeat(74)}\nMERGE GROUPS\n${"=".repeat(74)}`);
    for (const g of result.groups) {
      console.log(`\n  avg ${g.averageSimilarity}%  survivor=${g.survivorId}`);
      for (const m of g.members) {
        const mark = m.id === g.survivorId ? "KEEP " : "flag ";
        console.log(`    ${mark} ${m.title}  (${m.isNew ? "new draft" : `${m.viewCount} views`})`);
      }
    }
  }

  console.log(`\n${"=".repeat(74)}`);
  console.log(`  steps: ${result.steps.length}   elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  console.log(`  estimated cost: $${result.costUsd.toFixed(4)}`);
  for (const s of result.steps) {
    const model = s.model ? s.model.replace("gpt-5.6-", "") : "-";
    console.log(
      `    ${String(s.ms).padStart(6)}ms  $${s.costUsd.toFixed(4)}  ${model.padEnd(6)} ${s.name}`,
    );
  }

  const byModel: Record<string, number> = {};
  for (const s of result.steps) byModel[s.model ?? "-"] = (byModel[s.model ?? "-"] ?? 0) + s.costUsd;
  console.log("\n  cost by model:");
  for (const [m, c] of Object.entries(byModel)) {
    console.log(`    ${m.padEnd(16)} $${c.toFixed(4)}  (${((c / result.costUsd) * 100).toFixed(0)}%)`);
  }
}

main().catch((e) => {
  console.error("\nPIPELINE ERROR:", e);
  process.exit(1);
});
