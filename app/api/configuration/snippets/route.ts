import { z } from "zod";
import { apiError, requireActor } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { archiveSnippet, createSnippet, listSnippets, updateSnippet } from "@/lib/configuration/snippets";
import { snippetDraftSchema } from "@/lib/configuration/types";
import { resolveConnection } from "@/lib/ra/connections";

export const dynamic = "force-dynamic";
const connectionId = z.string().trim().min(1).max(100);
const createSchema = z.object({ connectionId, draft: snippetDraftSchema });
const updateSchema = createSchema.extend({ id: z.string().uuid() });

async function authorize(author: string, id: string) { await resolveConnection(author, id); }

export async function GET(request: Request) {
  try {
    const author = await requireActor(request), url = new URL(request.url);
    const id = connectionId.parse(url.searchParams.get("connectionId"));
    await authorize(author, id);
    return Response.json({ snippets: await listSnippets(id) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const author = await requireActor(request), body = await readJson(request, createSchema);
    await authorize(author, body.connectionId);
    return Response.json({ snippet: await createSnippet({ connectionId: body.connectionId, createdBy: author, draft: body.draft }) }, { status: 201 });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const author = await requireActor(request), body = await readJson(request, updateSchema);
    await authorize(author, body.connectionId);
    return Response.json({ snippet: await updateSnippet({ id: body.id, connectionId: body.connectionId, draft: body.draft }) });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    const author = await requireActor(request), url = new URL(request.url);
    const id = z.string().uuid().parse(url.searchParams.get("id")), selectedConnection = connectionId.parse(url.searchParams.get("connectionId"));
    await authorize(author, selectedConnection); await archiveSnippet(id, selectedConnection);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
