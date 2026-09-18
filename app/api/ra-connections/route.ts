import { z } from "zod";
import { requireActor, apiError } from "@/lib/api/auth";
import { readJson } from "@/lib/api/validation";
import { createConnection, deleteConnection, listConnections, setDefaultConnection, updateConnection } from "@/lib/ra/connections";

export const dynamic = "force-dynamic";
const fields = z.object({ name: z.string().trim().min(1).max(120), baseUrl: z.string().trim().min(1).max(1000), bearerToken: z.string().max(10000).optional(), user: z.string().trim().min(1).max(200) });

export async function GET(request: Request) {
  try { return Response.json({ connections: await listConnections(await requireActor(request)) }, { headers: { "cache-control": "no-store" } }); }
  catch (error) { return apiError(error); }
}
export async function POST(request: Request) {
  try {
    const owner = await requireActor(request);
    const input = await readJson(request, fields.extend({ bearerToken: z.string().trim().min(1).max(10000), makeDefault: z.boolean().optional() }));
    const id = await createConnection(owner, input);
    if (input.makeDefault) await setDefaultConnection(owner, id);
    return Response.json({ id }, { status: 201 });
  } catch (error) { return apiError(error); }
}
export async function PATCH(request: Request) {
  try {
    const owner = await requireActor(request);
    const body = await readJson(request, z.union([
      z.object({ id: z.string().max(100), makeDefault: z.literal(true) }),
      fields.extend({ id: z.string().max(100) }),
    ]));
    if ("makeDefault" in body) await setDefaultConnection(owner, body.id);
    else await updateConnection(owner, body.id, body);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
export async function DELETE(request: Request) {
  try {
    const owner = await requireActor(request);
    const id = new URL(request.url).searchParams.get("id") ?? "";
    await deleteConnection(owner, id);
    return Response.json({ ok: true });
  } catch (error) { return apiError(error); }
}
