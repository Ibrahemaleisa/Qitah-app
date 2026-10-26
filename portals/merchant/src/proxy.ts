import { NextResponse, type NextRequest } from "next/server";

/**
 * Page guard: portal pages need a session cookie. This is only a fast redirect for signed-out
 * visitors; the real checks happen in the API on every proxied call (an expired or revoked
 * session still ends in a 401 → login).
 */
export function proxy(req: NextRequest) {
  const hasSession = req.cookies.has("qm_rt") || req.cookies.has("qm_at");
  if (hasSession) return NextResponse.next();
  const url = req.nextUrl.clone();
  const next = req.nextUrl.pathname + req.nextUrl.search;
  url.pathname = "/login";
  url.search = next && next !== "/" ? `?next=${encodeURIComponent(next)}` : "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!api/|_next/|login|register|favicon\\.ico|icon|robots\\.txt).*)"],
};
