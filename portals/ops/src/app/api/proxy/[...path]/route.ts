import { NextResponse, type NextRequest } from 'next/server';

import { isAllowedPath } from '@/lib/server/allowlist';
import { serverConfig } from '@/lib/server/config';
import { csrfRejected, isSameOrigin } from '@/lib/server/csrf';
import { AuthFailure, clearSessionCookies, readSession, refreshSession, setSessionCookies, type SessionTokens } from '@/lib/server/session';

/**
 * BFF proxy: browser → /api/proxy/<allowlisted API path> → API_BASE_URL with the session's Bearer token.
 * - tokens live only in httpOnly cookies; the browser never sees them
 * - one transparent refresh on 401
 * - Origin check on mutations (CSRF)
 * - Server-Sent Events are streamed straight through
 */
const PASS_RESPONSE_HEADERS = ['content-type', 'cache-control', 'content-disposition', 'retry-after'];

const json = (status: number, code: string, message: string) => NextResponse.json({ error: { code, message } }, { status });

async function handle(req: NextRequest, ctx: RouteContext<'/api/proxy/[...path]'>) {
  const { path } = await ctx.params;
  const method = req.method.toUpperCase();
  if (!isAllowedPath(path, method)) return json(404, 'NOT_FOUND', 'Not found');
  if (!isSameOrigin(req)) return csrfRejected();

  const session = readSession(req);
  if (!session.accessToken && !session.refreshToken) return json(401, 'UNAUTHENTICATED', 'Sign in required');

  const { apiBaseUrl } = serverConfig();
  const target = `${apiBaseUrl}/${path.map(encodeURIComponent).join('/')}${req.nextUrl.search}`;
  const hasBody = !['GET', 'HEAD'].includes(method);
  const body = hasBody ? await req.arrayBuffer() : undefined;
  const isStream = path[1] === 'events' && path[2] === 'stream';

  const call = (token: string) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: req.headers.get('accept') ?? 'application/json' };
    // Bodies are forwarded as-is; an empty mutation body becomes `{}` (the API's JSON parser expects an object).
    if (hasBody) headers['content-type'] = body?.byteLength ? (req.headers.get('content-type') ?? 'application/json') : 'application/json';
    const requestId = req.headers.get('x-request-id');
    if (requestId) headers['x-request-id'] = requestId.slice(0, 100);
    return fetch(target, {
      method,
      headers,
      body: hasBody && body && body.byteLength ? body : hasBody ? '{}' : undefined,
      cache: 'no-store',
      redirect: 'manual',
      // Propagate client disconnects (important for SSE so the API stops its loop).
      signal: req.signal,
    });
  };

  let refreshed: SessionTokens | undefined;
  let upstream: Response | undefined;
  try {
    if (session.accessToken) upstream = await call(session.accessToken);
    if ((!upstream || upstream.status === 401) && session.refreshToken) {
      await upstream?.body?.cancel().catch(() => undefined);
      refreshed = await refreshSession(session.refreshToken, session.cognitoUser);
      upstream = await call(refreshed.accessToken);
    }
  } catch (e) {
    if (e instanceof AuthFailure) {
      const res = json(401, 'UNAUTHENTICATED', 'Session expired');
      clearSessionCookies(res);
      return res;
    }
    if ((e as Error).name === 'AbortError') return new NextResponse(null, { status: 499 });
    console.error('[proxy] upstream error', method, path.join('/'), e);
    return json(502, 'UPSTREAM_UNAVAILABLE', 'The Qitah API is unreachable');
  }
  if (!upstream) return json(401, 'UNAUTHENTICATED', 'Sign in required');

  const headers = new Headers();
  for (const h of PASS_RESPONSE_HEADERS) {
    const v = upstream.headers.get(h);
    if (v) headers.set(h, v);
  }
  if (isStream || headers.get('content-type')?.includes('text/event-stream')) {
    headers.set('cache-control', 'no-cache, no-transform');
    headers.set('x-accel-buffering', 'no');
    headers.set('connection', 'keep-alive');
  } else if (!headers.has('cache-control')) {
    headers.set('cache-control', 'no-store');
  }
  const res = new NextResponse(upstream.body, { status: upstream.status, headers });
  if (refreshed) setSessionCookies(res, refreshed);
  if (upstream.status === 401) clearSessionCookies(res);
  return res;
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
