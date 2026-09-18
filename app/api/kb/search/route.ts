import { requireActor, apiError } from "@/lib/api/auth";
import { NextResponse } from "next/server";
import { ra } from "@/lib/ra/client";
import { resolveConnection } from "@/lib/ra/connections";

export const dynamic = "force-dynamic";

export interface KbSearchRow {
  id: string;
  title: string;
  meta: string;
  status?: string;
}

/** KB picker behind the Content step's smart input. */
export async function GET(request: Request) {
  try {
  const user = await requireActor(request);
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return NextResponse.json({ rows: [] satisfies KbSearchRow[] });

    if (q.length > 500) throw new Error("Search query is too long");
    const result = await ra.search({
      queryText: q,
      searchType: "Neural",
      verboseResult: true,
      verboseResultFields: "title,status,template_name,collections",
      page: 1,
    }, { impUser: user, connection: await resolveConnection(user, url.searchParams.get("connectionId")) });

    const rows: KbSearchRow[] = result.solutions.slice(0, 10).map((s) => {
      const v = s.verboseSolutionResult;
      const parts = [v?.templateName, v?.status].filter(Boolean);
      return { id: s.id, title: s.title, status: v?.status, meta: parts.join(" · ") || "Solution" };
    });
    return NextResponse.json({ rows, totalHits: result.totalHits });
  } catch (err) {
    return apiError(err);
  }
}
