import { requireActor, apiError, ApiError } from "@/lib/api/auth";
import { getSolutionLaunch } from "@/lib/ks/solution-launches";

export const dynamic = "force-dynamic";
export async function GET(_request: Request, context: RouteContext<"/api/solution-launches/[launchId]">) {
  try {
    const { launchId } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(launchId)) throw new ApiError("Invalid Knowledge Studio launch");
    return Response.json({ launch: await getSolutionLaunch(await requireActor(_request), launchId) }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}
