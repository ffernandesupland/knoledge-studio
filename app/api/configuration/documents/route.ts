import { apiError, requireActor } from "@/lib/api/auth";
import { storeConfigurationDocument } from "@/lib/configuration/documents";
import { resolveConnection } from "@/lib/ra/connections";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const form = await request.formData();
    const connectionId = String(form.get("connectionId") ?? "").trim();
    const file = form.get("file");
    if (!connectionId) throw new Error("Choose a customer before uploading a document.");
    if (!(file instanceof File)) throw new Error("Choose a document to upload.");
    await resolveConnection(author, connectionId);
    const document = await storeConfigurationDocument({ connectionId, createdBy: author, name: file.name, mime: file.type, bytes: Buffer.from(await file.arrayBuffer()) });
    return Response.json({ document }, { status: 201 });
  } catch (error) { return apiError(error); }
}
