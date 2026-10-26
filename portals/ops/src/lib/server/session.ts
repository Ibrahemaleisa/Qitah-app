import 'server-only';

import type { NextRequest, NextResponse } from 'next/server';

import { cognitoPasswordLogin, cognitoRefresh } from './cognito';
import { COOKIE, serverConfig } from './config';

export type SessionTokens = {
  accessToken: string;
  refreshToken?: string;
  /** Seconds until the access token expires. */
  expiresIn: number;
  cognitoUser?: string;
};

export class AuthFailure extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const REFRESH_COOKIE_MAX_AGE = 30 * 86_400;

/** Exchanges email + password for tokens (local API login, or Cognito InitiateAuth). */
export async function passwordLogin(email: string, password: string): Promise<SessionTokens> {
  const cfg = serverConfig();
  if (cfg.authMode === 'cognito') {
    try {
      const t = await cognitoPasswordLogin(email, password);
      // The API accepts Cognito ID tokens (token_use=id, aud=client id) as Bearer tokens.
      return { accessToken: t.idToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn, cognitoUser: t.username };
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === 'NotAuthorizedException' || code === 'UserNotFoundException') throw new AuthFailure(401, 'UNAUTHENTICATED', 'Incorrect email or password');
      throw new AuthFailure(502, 'AUTH_PROVIDER_ERROR', (e as Error).message);
    }
  }
  const res = await fetch(`${cfg.apiBaseUrl}/v1/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as { accessToken?: string; refreshToken?: string; expiresIn?: number; error?: { code: string; message: string } };
  if (!res.ok || !body.accessToken) {
    throw new AuthFailure(res.status === 429 ? 429 : res.status >= 500 ? 502 : 401, body.error?.code ?? 'UNAUTHENTICATED', body.error?.message ?? 'Sign-in failed');
  }
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, expiresIn: body.expiresIn ?? 3600 };
}

/*
 * Single-flight refresh. The API rotates refresh tokens (the old one is revoked on use), so several
 * concurrent requests that all see a 401 must share ONE refresh call, and requests that arrive a moment
 * later with the old cookie must reuse its result. Process-local: with several portal instances behind
 * a load balancer, enable sticky sessions or accept an occasional re-login.
 */
const inflight = new Map<string, Promise<SessionTokens>>();
const recent = new Map<string, { tokens: SessionTokens; at: number }>();
const RECENT_MS = 30_000;

export function refreshSession(refreshToken: string, cognitoUser?: string): Promise<SessionTokens> {
  const hit = recent.get(refreshToken);
  if (hit && Date.now() - hit.at < RECENT_MS) return Promise.resolve(hit.tokens);
  const running = inflight.get(refreshToken);
  if (running) return running;
  const p = doRefresh(refreshToken, cognitoUser)
    .then((tokens) => {
      recent.set(refreshToken, { tokens, at: Date.now() });
      for (const [k, v] of recent) if (Date.now() - v.at > RECENT_MS) recent.delete(k);
      return tokens;
    })
    .finally(() => inflight.delete(refreshToken));
  inflight.set(refreshToken, p);
  return p;
}

async function doRefresh(refreshToken: string, cognitoUser?: string): Promise<SessionTokens> {
  const cfg = serverConfig();
  if (cfg.authMode === 'cognito') {
    try {
      const t = await cognitoRefresh(refreshToken, cognitoUser);
      return { accessToken: t.idToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn, cognitoUser: t.username };
    } catch (e) {
      throw new AuthFailure(401, 'UNAUTHENTICATED', (e as Error).message);
    }
  }
  const res = await fetch(`${cfg.apiBaseUrl}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as { accessToken?: string; refreshToken?: string; expiresIn?: number };
  if (!res.ok || !body.accessToken) throw new AuthFailure(401, 'UNAUTHENTICATED', 'Session expired');
  return { accessToken: body.accessToken, refreshToken: body.refreshToken, expiresIn: body.expiresIn ?? 3600 };
}

/** Best-effort server-side revocation of the refresh token (local mode). */
export async function revokeSession(refreshToken: string | undefined) {
  const cfg = serverConfig();
  if (!refreshToken || cfg.authMode !== 'local') return;
  await fetch(`${cfg.apiBaseUrl}/v1/auth/logout`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  }).catch(() => undefined);
}

function cookieBase() {
  return { httpOnly: true, secure: serverConfig().secureCookies, sameSite: 'strict' as const, path: '/' };
}

export function setSessionCookies(res: NextResponse, t: SessionTokens) {
  const base = cookieBase();
  res.cookies.set(COOKIE.access, t.accessToken, { ...base, maxAge: Math.max(60, t.expiresIn - 30) });
  if (t.refreshToken) res.cookies.set(COOKIE.refresh, t.refreshToken, { ...base, maxAge: REFRESH_COOKIE_MAX_AGE });
  if (t.cognitoUser) res.cookies.set(COOKIE.cognitoUser, t.cognitoUser, { ...base, maxAge: REFRESH_COOKIE_MAX_AGE });
}

export function clearSessionCookies(res: NextResponse) {
  const base = cookieBase();
  for (const name of Object.values(COOKIE)) res.cookies.set(name, '', { ...base, maxAge: 0 });
}

export function readSession(req: NextRequest) {
  return {
    accessToken: req.cookies.get(COOKIE.access)?.value,
    refreshToken: req.cookies.get(COOKIE.refresh)?.value,
    cognitoUser: req.cookies.get(COOKIE.cognitoUser)?.value,
  };
}
