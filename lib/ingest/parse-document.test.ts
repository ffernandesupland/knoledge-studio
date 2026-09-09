import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { classify, parseDocument, MAX_UPLOAD_BYTES } from "@/lib/ingest/parse-document";

describe("classify", () => {
  it("accepts supported mime types", () => {
    expect(classify("a.pdf", "application/pdf")).toBe("pdf");
    expect(
      classify("a.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe("docx");
    expect(classify("a.txt", "text/plain")).toBe("text");
    expect(classify("a.txt", "text/plain; charset=utf-8")).toBe("text");
  });

  it("falls back to the extension when the browser sends no useful mime", () => {
    expect(classify("notes.md", "")).toBe("text");
    expect(classify("report.pdf", "application/octet-stream")).toBe("pdf");
  });

  it("refuses anything not on the allowlist", () => {
    for (const [name, mime] of [
      ["evil.exe", "application/x-msdownload"],
      ["evil.svg", "image/svg+xml"],
      ["evil.html", "text/html"],
      ["evil.sh", "application/x-sh"],
      ["noextension", ""],
    ]) {
      expect(classify(name, mime), name).toBeNull();
    }
  });
});

describe("parseDocument", () => {
  it("extracts text from a real PDF using the Node parser and worker", async () => {
    const buffer = readFileSync(new URL("./fixtures/text.pdf", import.meta.url));
    const doc = await parseDocument("text.pdf", "application/pdf", buffer);
    expect(doc.kind).toBe("pdf");
    expect(doc.text).toContain("Knowledge Studio PDF upload test");
  });

  it("reads plain text", async () => {
    const doc = await parseDocument("notes.txt", "text/plain", Buffer.from("Line one\r\nLine two"));
    expect(doc.kind).toBe("text");
    expect(doc.text).toBe("Line one\nLine two");
  });

  it("collapses runs of blank lines", async () => {
    const doc = await parseDocument("n.txt", "text/plain", Buffer.from("a\n\n\n\n\nb"));
    expect(doc.text).toBe("a\n\nb");
  });

  it("rejects an unsupported type", async () => {
    await expect(parseDocument("x.exe", "application/x-msdownload", Buffer.from("MZ"))).rejects.toThrow(
      /Unsupported file type/,
    );
  });

  it("rejects an oversized file before parsing it", async () => {
    const big = Buffer.alloc(MAX_UPLOAD_BYTES + 1);
    await expect(parseDocument("big.txt", "text/plain", big)).rejects.toThrow(/larger than the 4 MB/);
  });

  it("rejects a file with no readable text", async () => {
    await expect(parseDocument("empty.txt", "text/plain", Buffer.from("   \n  "))).rejects.toThrow(
      /No readable text/,
    );
  });
});
