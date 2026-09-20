import { randomUUID } from "node:crypto";
import { db } from "../db";
import { ApiError } from "../api/auth";
import { MAX_UPLOAD_BYTES } from "../ingest/limits";

export async function storeAgentFile(owner: string, name: string, mime: string, bytes: Buffer) {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new ApiError("File exceeds 4 MB", 413);
  const id = randomUUID();
  await db().transaction(async () => {
    await db().prepare("INSERT INTO agent_uploaded_files(id,owner,name,mime,bytes,created_at) VALUES(?,?,?,?,?,?)").run(id, owner, name, mime, bytes.length, new Date().toISOString());
    for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
      await db().prepare("INSERT INTO agent_uploaded_file_chunks(file_id,position,data) VALUES(?,?,?)").run(id, offset, bytes.subarray(offset, offset + 256 * 1024));
    }
  })();
  return id;
}

export async function getAgentFile(id: string, owner: string) {
  const row = await db().prepare("SELECT owner,name,mime FROM agent_uploaded_files WHERE id=?").get(id) as { owner: string; name: string; mime: string } | undefined;
  if (!row || row.owner !== owner) throw new ApiError("Attached file not found", 404);
  const chunks = await db().prepare("SELECT data FROM agent_uploaded_file_chunks WHERE file_id=? ORDER BY position").all(id) as { data: ArrayBuffer }[];
  return { name: row.name, mime: row.mime, bytes: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk.data))) };
}

/** Confirm browser-provided file IDs belong to the signed-in actor before a model call. */
export async function assertAgentFileOwnership(ids: string[], owner: string) {
  for (const id of new Set(ids)) await getAgentFile(id, owner);
}
