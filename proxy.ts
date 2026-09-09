import { NextRequest, NextResponse } from "next/server";
import { requireActor, ApiError } from "@/lib/api/auth";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/login" || path.startsWith("/api/auth/")) return NextResponse.next();
  try {
    await requireActor(request);
    return NextResponse.next();
  } catch (error) {
    if (path.startsWith("/api/")) return NextResponse.json({ error: error instanceof Error ? error.message : "Sign in required" }, { status: error instanceof ApiError ? error.status : 401 });
    const url = new URL("/login", request.url);
    url.searchParams.set("next", `${path}${request.nextUrl.search}`);
    return NextResponse.redirect(url);
  }
}
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
