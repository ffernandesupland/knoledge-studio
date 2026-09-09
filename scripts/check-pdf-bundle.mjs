// Run after `npm run build`. Exercise only dependencies in the ingest route trace.
import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = process.cwd();
const manifest = path.join(root, ".next/server/app/api/ingest/route.js.nft.json");
const files = JSON.parse(readFileSync(manifest, "utf8")).files;
assert.ok(files.some((file) => /canvas.*\.node$/.test(file)), "Ingest trace must include the native canvas binary");
assert.ok(files.some((file) => file.endsWith("/pdfjs-dist/legacy/build/pdf.worker.mjs")), "Ingest trace must include the PDF worker");
const isolated = mkdtempSync(path.join(tmpdir(), "ks-pdf-bundle-"));
try {
  for (const file of files) {
    const source = path.resolve(path.dirname(manifest), file);
    const relative = path.relative(root, source);
    if (!relative.startsWith(`node_modules${path.sep}`) || !statSync(source).isFile()) continue;
    const target = path.join(isolated, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  }
  assert.ok(existsSync(path.join(isolated, "node_modules/pdf-parse/package.json")));
  writeFileSync(path.join(isolated, "extract.mjs"), `
    import { readFileSync } from "node:fs";
    import { PDFParse } from "pdf-parse";
    const parser = new PDFParse({ data: readFileSync(0) });
    try { console.log((await parser.getText()).text); }
    finally { await parser.destroy(); }
  `);
  const result = spawnSync(process.execPath, [path.join(isolated, "extract.mjs")], {
    cwd: isolated, encoding: "utf8", timeout: 30_000,
    input: readFileSync(path.join(root, "lib/ingest/fixtures/text.pdf")),
    env: { ...process.env, NODE_PATH: "" },
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /Knowledge Studio PDF upload test/);
  console.log("PASS: PDF extraction from isolated production-traced dependencies.");
} finally { rmSync(isolated, { recursive: true, force: true }); }
