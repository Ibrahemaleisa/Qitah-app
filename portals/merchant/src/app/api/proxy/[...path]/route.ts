import { NextResponse, type NextRequest } from "next/server";

import { resolveProxyPath } from "@/lib/server/allowlist";
import { serverConfig } from "@/lib/server/config";
import { checkCsrf, errorResponse, readJsonText } from "@/lib/server/http";
import { clearSessionCookies, readSession, refreshSession, setSessionCookies, type Tokens } from "@/lib/server/session";

/**
 * Backend-for-frontend proxy: /api/proxy/<path> → API_BASE_URL/<path> with the session's Bearer token.
 * Only allowlisted merchant-facing paths are reachable (lib/server/allowlist.ts); the rest is a 404.
 */
const FORWARD_REQUEST_HEADERS = ["accept", "content-type", "last-event-id", "user-agent", "accept-language"];
const FORWARD_RESPONSE_HEADERS = ["content-type", "cache-control", "retry-after", "x-ratelimit-limit", "x-ratelimit-remaining", "x-ratelimit-reset"];

async function handle(req: NextRequest, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: segments } = await ctx.params;
  const path = resolveProxyPath(segments);
  if (!path) return errorResponse(404, "NOT_FOUND", "Not found");

  const csrf = checkCsrf(req);
  if (csrf) return csrf;

  const method = req.method.toUpperCase();
  let body: string | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const text = await readJsonText(req);
    if (text instanceof Error) return errorResponse(413, "TOO_LARGE", "Request body too large");
    body = text;
  }

  const target = `${serverConfig.apiBaseUrl}/${path}${req.nextUrl.search}`;
  const baseHeaders = new Headers();
  for (const h of FORWARD_REQUEST_HEADERS) {
    const v = req.headers.get(h);
    if (v) baseHeaders.set(h, v);
  }
  if (body !== undefined && !baseHeaders.has("content-type")) baseHeaders.set("content-type", "application/json");

  const send = (token: string | undefined) => {
    const headers = new Headers(baseHeaders);
    if (token) headers.set("authorization", `Bearer ${token}`);
    return fetch(target, { method, headers, body, cache: "no-store", redirect: "manual", signal: req.signal });
  };

  const session = readSession(req);
  let rotated: Tokens | undefined;
  let sessionExpired = false;

  const tryRefresh = async (previous?: string) => {
    if (!session.refreshToken || rotated) return false;
    const r = await refreshSession(session.refreshToken, previous, req.headers.get("user-agent"));
    if (r.ok) {
      rotated = r.tokens;
      return true;
    }
    if (r.expired) sessionExpired = true;
    return false;
  };

  let upstream: Response;
  try {
    let token = session.accessToken;
    if (!token && (await tryRefresh())) token = rotated!.accessToken;
    upstream = await send(token);
    if (upstream.status === 401 && token && (await tryRefresh(token))) {
      await upstream.body?.cancel();
      upstream = await send(rotated!.accessToken);
    }
  } catch (e) {
    if (req.signal.aborted) return new NextResponse(null, { status: 499 });
    void e;
    return errorResponse(502, "API_UNAVAILABLE", "Qitah API is unreachable");
  }

  const headers = new Headers();
  for (const h of FORWARD_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  const isStream = (upstream.headers.get("content-type") ?? "").startsWith("text/event-stream");
  if (isStream) {
    // Unbuffered pass-through: no-transform stops compression, X-Accel-Buffering stops nginx-style buffering.
    headers.set("cache-control", "no-cache, no-transform");
    headers.set("x-accel-buffering", "no");
  } else {
    headers.set("cache-control", "no-store");
  }

  const res = new NextResponse(upstream.body, { status: upstream.status, headers });
  if (rotated) setSessionCookies(res, rotated);
  else if (sessionExpired || (upstream.status === 401 && !session.refreshToken && session.accessToken)) clearSessionCookies(res);
  return res;
}

export { handle as GET, handle as POST, handle as PUT, handle as PATCH, handle as DELETE };
