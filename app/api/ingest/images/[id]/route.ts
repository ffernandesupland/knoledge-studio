import { requireActor, apiError } from "@/lib/api/auth";
import { getImage } from "@/lib/ingest/image-store";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const author = await requireActor(request);
    const image = await getImage((await context.params).id, author);
    return new Response(new Uint8Array(image.bytes), { headers: { "content-type": image.mime, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (error) { return apiError(error); }
}
