import { NextResponse, type NextRequest } from "next/server";

import { cognitoLogin, CognitoError } from "@/lib/server/cognito";
import { serverConfig } from "@/lib/server/config";
import { checkCsrf, errorResponse, upstreamJson } from "@/lib/server/http";
import { isTokens, setSessionCookies, type Tokens } from "@/lib/server/session";

export async function POST(req: NextRequest) {
  const csrf = checkCsrf(req);
  if (csrf) return csrf;

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, "INVALID_JSON", "Body is not valid JSON");
  }
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password || email.length > 200 || password.length > 200) {
    return errorResponse(400, "VALIDATION_FAILED", "Email and password are required");
  }

  let tokens: Tokens;
  if (serverConfig.authMode === "cognito") {
    try {
      tokens = await cognitoLogin(email, password);
    } catch (e) {
      if (e instanceof CognitoError) return errorResponse(e.status, e.code, e.message);
      return errorResponse(502, "AUTH_UNAVAILABLE", "Sign-in service unavailable");
    }
  } else {
    let r;
    try {
      r = await upstreamJson("/v1/auth/login", { body: { email, password }, userAgent: req.headers.get("user-agent") });
    } catch {
      return errorResponse(502, "API_UNAVAILABLE", "Qitah API is unreachable");
    }
    if (!r.ok || !isTokens(r.json)) {
      const err = (r.json?.error ?? {}) as { code?: string; message?: string };
      return errorResponse(r.status >= 400 ? r.status : 502, err.code ?? "LOGIN_FAILED", err.message ?? "Sign-in failed");
    }
    tokens = r.json;
  }

  const res = NextResponse.json({ ok: true }, { headers: { "cache-control": "no-store" } });
  setSessionCookies(res, tokens);
  return res;
}
