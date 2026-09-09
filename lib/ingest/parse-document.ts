export interface ParsedDocument {
  name: string;
  text: string;
  bytes: number;
  kind: "pdf" | "docx" | "text";
}

import { MAX_UPLOAD_BYTES, MAX_UPLOAD_MB } from "./limits";
export { MAX_UPLOAD_BYTES } from "./limits";

/** Allowlist rather than a denylist: anything not named here is refused. */
const ACCEPTED: Record<string, ParsedDocument["kind"]> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/plain": "text",
  "text/markdown": "text",
  "text/csv": "text",
};

const EXTENSIONS: Record<string, ParsedDocument["kind"]> = {
  pdf: "pdf",
  docx: "docx",
  txt: "text",
  md: "text",
  csv: "text",
};

export function classify(name: string, mime: string): ParsedDocument["kind"] | null {
  const byMime = ACCEPTED[mime.split(";")[0].trim().toLowerCase()];
  if (byMime) return byMime;
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSIONS[ext] ?? null;
}

/**
 * Parses an uploaded document to plain text. Content is treated as untrusted data from here on;
 * parsing happens server-side and nothing is ever executed.
 */
export async function parseDocument(
  name: string,
  mime: string,
  buffer: Buffer,
): Promise<ParsedDocument> {
  if (buffer.byteLength > MAX_UPLOAD_BYTES) {
    throw new Error(`${name} is larger than the ${MAX_UPLOAD_MB} MB limit`);
  }

  const kind = classify(name, mime);
  if (!kind) throw new Error(`Unsupported file type: ${name}`);

  let text: string;
  if (kind === "pdf") {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    try {
      text = (await parser.getText()).text;
    } finally {
      await parser.destroy();
    }
  } else if (kind === "docx") {
    const mammoth = await import("mammoth");
    text = (await mammoth.extractRawText({ buffer })).value;
  } else {
    text = buffer.toString("utf8");
  }

  text = text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) throw new Error(`No readable text found in ${name}`);

  return { name, text, bytes: buffer.byteLength, kind };
}
