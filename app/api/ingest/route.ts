import { requireActor, apiError } from "@/lib/api/auth";
import { fetchUrlSafely } from "@/lib/ingest/fetch-url";
import { MAX_UPLOAD_BYTES, parseDocument } from "@/lib/ingest/parse-document";

import { classify } from "@/lib/ingest/parse-document";
import { storeImage } from "@/lib/ingest/image-store";
import { MAX_UPLOAD_MB } from "@/lib/ingest/limits";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export interface IngestedSource {
  label: string;
  text: string;
  meta: string;
  kind?: string;
  imageId?: string;
}

/**
 * Turns a URL or an uploaded file into plain text for the pipeline. Both paths are
 * security-sensitive: see lib/ingest/ssrf.ts and the upload allowlist.
 */
export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  try {
    const author = await requireActor(request);
    if (contentType.includes("application/json")) {
      const { url } = (await request.json()) as { url?: string };
      if (!url?.trim()) return Response.json({ error: "No URL provided" }, { status: 400 });

      const page = await fetchUrlSafely(url.trim());
      const source: IngestedSource = {
        label: page.title || page.url,
        text: page.text,
        meta: `${Math.round(page.bytes / 1024)} KB from ${new URL(page.url).hostname}`,
      };
      return Response.json({ source });
    }

    if (contentType.includes("multipart/form-data")) {
      const form = await request.formData();
      const file = form.get("file");
      if (!(file instanceof File)) {
        return Response.json({ error: "No file provided" }, { status: 400 });
      }
      if (file.size > MAX_UPLOAD_BYTES) {
        return Response.json({ error: `${file.name} is larger than the ${MAX_UPLOAD_MB} MB limit` }, { status: 413 });
      }

      const buffer = Buffer.from(await file.arrayBuffer());
      if (classify(file.name, file.type) === "image") {
        const imageId = await storeImage(author, file.name, buffer);
        return Response.json({ source: { label: file.name, text: `Original image: ${file.name}`, kind: "image", imageId, meta: `${Math.round(file.size / 1024)} KB · IMAGE` } });
      }
      const parsed = await parseDocument(file.name, file.type, buffer);
      const source: IngestedSource = {
        kind: parsed.kind,
        label: parsed.name,
        text: parsed.text,
        meta: `${Math.round(parsed.bytes / 1024)} KB · ${parsed.kind === "image" ? "IMAGE · " + file.name.split(".").pop()?.toUpperCase() : parsed.kind.toUpperCase()}`,
      };
      return Response.json({ source });
    }

    return Response.json({ error: "Send JSON with a url, or a multipart file" }, { status: 415 });
  } catch (err) {
    return apiError(err);
  }
}
