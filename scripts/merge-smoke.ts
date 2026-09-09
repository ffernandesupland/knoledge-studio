/**
 * Merge smoke test. Retrieves two real QA solutions and combines them into one template's
 * fields, the same way execute.ts does at submit time. Read-only: nothing is written back.
 *
 * Run: npm run merge-smoke
 */
import "dotenv/config";
import { mergeGroupFields } from "../lib/pipeline/merge";
import { ra } from "../lib/ra/client";

/** Two genuinely overlapping VPN troubleshooting articles in the QA tenant. */
const A = "260717092646280";
const B = "260324150400190";

async function main() {
  const [a, b] = await Promise.all([ra.getSolution(A), ra.getSolution(B)]);
  console.log(`A ${a.id}  "${a.title}"  [${a.templateName}]  ${a.viewCount} views`);
  console.log(`B ${b.id}  "${b.title}"  [${b.templateName}]  ${b.viewCount} views\n`);

  console.log("merging…\n");
  const result = await mergeGroupFields({
    survivorId: A,
    survivorTitle: a.title,
    survivorTemplateName: a.templateName ?? "unknown",
    survivorFields: (a.fields ?? [])
      .filter((f) => f.content?.trim())
      .map((f) => ({ fieldName: f.name, fieldValue: f.content })),
    sources: [{ id: B, title: b.title }],
  });

  console.log(`template warning: ${result.templateWarning ?? "none"}`);
  console.log(`cost:            $${result.costUsd.toFixed(4)}\n`);

  for (const f of result.fields) {
    const v = f.fieldValue.replace(/\s+/g, " ").trim();
    console.log(`  ${f.fieldName.padEnd(16)} ${v ? v.slice(0, 95) : "(empty)"}`);
  }
}

main().catch((e) => {
  console.error("MERGE SMOKE ERROR:", e);
  process.exit(1);
});
