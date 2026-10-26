import type { NextRequest, NextResponse } from "next/server";

import { cognitoRefresh, cognitoRevoke, CognitoError } from "./cognito";
import { serverConfig } from "./config";
import { upstreamJson } from "./http";

/**
 * Session = two httpOnly cookies holding the API tokens. The browser can never read them;
 * only this server attaches them (as a Bearer header) when proxying to the API.
 */
export const ACCESS_COOKIE = "qm_at";
export const REFRESH_COOKIE = "qm_rt";
const REFRESH_MAX_AGE = 30 * 24 * 60 * 60; // matches the API's refresh token lifetime

export type Tokens = { accessToken: string; refreshToken: string; expiresIn: number };

export function isTokens(v: unknown): v is Tokens {
  const t = v as Partial<Tokens> | undefined;
  return !!t && typeof t.accessToken === "string" && typeof t.refreshToken === "string";
}

function cookieBase() {
  return { httpOnly: true, secure: serverConfig.cookieSecure, sameSite: "lax" as const, path: "/" };
}

export function setSessionCookies(res: NextResponse, tokens: Tokens) {
  // Expire the access cookie a little before the token so we refresh instead of sending a dead token.
  const accessAge = Math.max(60, Math.floor((tokens.expiresIn || 3600) - 30));
  res.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...cookieBase(), maxAge: accessAge });
  res.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...cookieBase(), maxAge: REFRESH_MAX_AGE });
}

export function clearSessionCookies(res: NextResponse) {
  res.cookies.set(ACCESS_COOKIE, "", { ...cookieBase(), maxAge: 0 });
  res.cookies.set(REFRESH_COOKIE, "", { ...cookieBase(), maxAge: 0 });
}

export function readSession(req: NextRequest) {
  return { accessToken: req.cookies.get(ACCESS_COOKIE)?.value, refreshToken: req.cookies.get(REFRESH_COOKIE)?.value };
}

export type RefreshOutcome = { ok: true; tokens: Tokens } | { ok: false; expired: boolean };

/**
 * Refresh tokens rotate on use, so concurrent requests that all hit a 401 must share ONE refresh
 * call. Results are kept briefly so requests that were already in flight with the old cookie
 * (before the browser stored the new one) get the same new tokens instead of a revoked-token 401.
 * This is per server instance; behind several instances, use sticky sessions or a shared store.
 */
const inflight = new Map<string, { promise: Promise<RefreshOutcome>; expiresAt: number }>();

export function refreshSession(refreshToken: string, previousAccessToken?: string, userAgent?: string | null): Promise<RefreshOutcome> {
  const now = Date.now();
  for (const [k, v] of inflight) if (v.expiresAt < now) inflight.delete(k);
  const hit = inflight.get(refreshToken);
  if (hit) return hit.promise;
  const promise = doRefresh(refreshToken, previousAccessToken, userAgent);
  inflight.set(refreshToken, { promise, expiresAt: now + 30_000 });
  return promise;
}

async function doRefresh(refreshToken: string, previousAccessToken?: string, userAgent?: string | null): Promise<RefreshOutcome> {
  try {
    if (serverConfig.authMode === "cognito") {
      return { ok: true, tokens: await cognitoRefresh(refreshToken, previousAccessToken) };
    }
    const r = await upstreamJson("/v1/auth/refresh", { body: { refreshToken }, userAgent });
    if (r.ok && isTokens(r.json)) return { ok: true, tokens: r.json };
    return { ok: false, expired: r.status === 401 || r.status === 400 };
  } catch (e) {
    if (e instanceof CognitoError) return { ok: false, expired: e.status === 401 || e.status === 400 };
    return { ok: false, expired: false };
  }
}

export async function revokeSession(refreshToken: string) {
  try {
    if (serverConfig.authMode === "cognito") await cognitoRevoke(refreshToken);
    else await upstreamJson("/v1/auth/logout", { body: { refreshToken } });
  } catch {
    // Logging out must always clear the cookies, even if the API is unreachable.
  }
}
