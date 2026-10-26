import { NextResponse, type NextRequest } from "next/server";

import { checkCsrf, errorResponse, readJsonText, upstreamJson } from "@/lib/server/http";
import { isTokens, readSession, refreshSession, setSessionCookies, type Tokens } from "@/lib/server/session";

/**
 * Merchant application. Public in local mode (the API creates the owner account and returns a
 * session, which we turn into cookies and strip from the response). If the caller is already
 * signed in, the application is attached to their existing account instead.
 */
export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;
  const text = await readJsonText(req, 64 * 1024);
  if (text instanceof Error) return errorResponse(413, "TOO_LARGE", "Request body too large");
  if (!text) return errorResponse(400, "VALIDATION_FAILED", "Body required");

  const session = readSession(req);
  let token = session.accessToken;
  let rotated: Tokens | undefined;
  if (!token && session.refreshToken) {
    const r = await refreshSession(session.refreshToken, undefined, req.headers.get("user-agent"));
    if (r.ok) {
      token = r.tokens.accessToken;
      rotated = r.tokens;
    }
  }

  let r;
  try {
    r = await upstreamJson("/v1/merchant-applications", { body: text, token, userAgent: req.headers.get("user-agent") });
    if (r.status === 401 && token && session.refreshToken && !rotated) {
      const refreshed = await refreshSession(session.refreshToken, token, req.headers.get("user-agent"));
      if (refreshed.ok) {
        rotated = refreshed.tokens;
        r = await upstreamJson("/v1/merchant-applications", { body: text, token: rotated.accessToken, userAgent: req.headers.get("user-agent") });
      }
    }
  } catch {
    return errorResponse(502, "API_UNAVAILABLE", "Qitah API is unreachable");
  }
  if (!r.ok) {
    const err = (r.json?.error ?? {}) as { code?: string; message?: string; details?: unknown };
    return errorResponse(r.status, err.code ?? "REGISTRATION_FAILED", err.message ?? "Registration failed", err.details);
  }

  const { session: newSession, ...rest } = (r.json ?? {}) as { session?: unknown } & Record<string, unknown>;
  const res = NextResponse.json(rest, { headers: { "cache-control": "no-store" } });
  if (isTokens(newSession)) setSessionCookies(res, newSession);
  else if (rotated) setSessionCookies(res, rotated);
  return res;
}
