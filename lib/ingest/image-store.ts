import { randomUUID } from "node:crypto";
import { db } from "../db";
import { ApiError } from "../api/auth";
import { imageMime } from "./read-image";
import { MAX_UPLOAD_BYTES } from "./limits";
import type { SourceInput } from "../ks/source-document";

export async function storeImage(author: string, name: string, bytes: Buffer) {
  if (bytes.length > MAX_UPLOAD_BYTES) throw new ApiError("Image exceeds 4 MB", 413);
  const mime = imageMime(bytes);
  const id = randomUUID();
  await db().transaction(async () => {
    await db().prepare("INSERT INTO source_images(id,author,name,mime,bytes) VALUES (?,?,?,?,?)").run(id, author, name, mime, bytes.length);
    for (let offset = 0; offset < bytes.length; offset += 256 * 1024) {
      await db().prepare("INSERT INTO source_image_chunks(image_id,position,data) VALUES (?,?,?)").run(id, offset, bytes.subarray(offset, offset + 256 * 1024));
    }
  })();
  return id;
}

export async function getImage(id: string, author?: string) {
  const row = await db().prepare("SELECT author,name,mime FROM source_images WHERE id=?").get(id) as { author: string; name: string; mime: string } | undefined;
  if (!row || (author !== undefined && row.author !== author)) throw new ApiError("Image not found", 404);
  const chunks = await db().prepare("SELECT data FROM source_image_chunks WHERE image_id=? ORDER BY position").all(id) as { data: ArrayBuffer }[];
  return { ...row, bytes: Buffer.concat(chunks.map(c => Buffer.from(c.data))) };
}

export async function assertImageOwnership(input: SourceInput, author: string) {
  for (const id of new Set((input.attachments ?? []).flatMap(a => a.imageId ? [a.imageId] : []))) {
    const row = await db().prepare("SELECT author FROM source_images WHERE id=?").get(id) as { author: string } | undefined;
    if (!row || row.author !== author) throw new ApiError("Image not found", 404);
  }
}
