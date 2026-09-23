import { z } from "zod";
import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { archiveConfigurationProfile, createConfigurationProfile, listConfigurationProfiles, updateConfigurationProfile } from "@/lib/configuration/store";
import { configurationProfileDraftSchema, configurationProfileKindSchema } from "@/lib/configuration/types";
import { resolveConnection } from "@/lib/ra/connections";

export const dynamic = "force-dynamic";

const connectionId = z.string().trim().min(1).max(100);
const createSchema = z.object({ connectionId, draft: configurationProfileDraftSchema });
const updateSchema = createSchema.extend({ id: z.string().uuid() });

async function authorizeConnection(author: string, id: string) {
  await resolveConnection(author, id);
}

export async function GET(request: Request) {
  try {
    const author = await requireActor(request);
    const url = new URL(request.url);
    const id = connectionId.parse(url.searchParams.get("connectionId"));
    const kind = configurationProfileKindSchema.parse(url.searchParams.get("kind"));
    await authorizeConnection(author, id);
    return Response.json({ profiles: await listConfigurationProfiles(id, kind) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const author = await requireActor(request);
    const body = await readJson(request, createSchema);
    await authorizeConnection(author, body.connectionId);
    const profile = await createConfigurationProfile({ connectionId: body.connectionId, createdBy: author, draft: body.draft });
    return Response.json({ profile }, { status: 201 });
  } catch (error) { return apiError(error); }
}

export async function PATCH(request: Request) {
  try {
    const author = await requireActor(request);
    const body = await readJson(request, updateSchema);
    await authorizeConnection(author, body.connectionId);
    const profile = await updateConfigurationProfile({ id: body.id, connectionId: body.connectionId, draft: body.draft });
    return Response.json({ profile });
  } catch (error) { return apiError(error); }
}

export async function DELETE(request: Request) {
  try {
    const author = await requireActor(request);
    const url = new URL(request.url);
    const id = z.string().uuid().parse(url.searchParams.get("id"));
    const selectedConnection = connectionId.parse(url.searchParams.get("connectionId"));
    await authorizeConnection(author, selectedConnection);
    await archiveConfigurationProfile(id, selectedConnection);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
