import { randomUUID } from "node:crypto";
import { db } from "../db";
import { MAX_UPLOAD_BYTES, classify, parseDocument } from "../ingest/parse-document";

export interface ConfigurationDocument {
  id: string;
  connectionId: string;
  name: string;
  mime: string;
  bytes: number;
  extractedText: string;
  createdAt: string;
}

export async function getConfigurationDocument(id: string, connectionId: string): Promise<ConfigurationDocument> {
  const row = await db().prepare("SELECT id,connection_id,name,mime,bytes,extracted_text,created_at FROM configuration_documents WHERE id=? AND connection_id=?").get(id, connectionId) as { id: string; connection_id: string; name: string; mime: string; bytes: number; extracted_text: string; created_at: string } | undefined;
  if (!row) throw new Error("Configuration document was not found for this customer.");
  return { id: row.id, connectionId: row.connection_id, name: row.name, mime: row.mime, bytes: row.bytes, extractedText: row.extracted_text, createdAt: row.created_at };
}

export async function storeConfigurationDocument(args: { connectionId: string; createdBy: string; name: string; mime: string; bytes: Buffer }): Promise<ConfigurationDocument> {
  if (args.bytes.length > MAX_UPLOAD_BYTES) throw new Error("Configuration document exceeds the 4 MB limit.");
  const kind = classify(args.name, args.mime);
  if (!kind || kind === "image") throw new Error("Upload a PDF, DOCX, or text document for configuration content.");
  const parsed = await parseDocument(args.name, args.mime, args.bytes);
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  await db().transaction(async () => {
    await db().prepare("INSERT INTO configuration_documents(id,connection_id,name,mime,bytes,extracted_text,created_by,created_at) VALUES(?,?,?,?,?,?,?,?)")
      .run(id, args.connectionId, parsed.name, args.mime || "text/plain", args.bytes.length, parsed.text, args.createdBy, createdAt);
    for (let offset = 0, position = 0; offset < args.bytes.length; offset += 256 * 1024, position++) {
      await db().prepare("INSERT INTO configuration_document_chunks(document_id,position,data) VALUES(?,?,?)").run(id, position, args.bytes.subarray(offset, offset + 256 * 1024));
    }
  })();
  return { id, connectionId: args.connectionId, name: parsed.name, mime: args.mime || "text/plain", bytes: args.bytes.length, extractedText: parsed.text, createdAt };
}
