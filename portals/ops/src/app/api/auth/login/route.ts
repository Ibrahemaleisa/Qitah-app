import { NextResponse, type NextRequest } from 'next/server';

import { csrfRejected, isSameOrigin } from '@/lib/server/csrf';
import { AuthFailure, passwordLogin, setSessionCookies } from '@/lib/server/session';

/** Only same-site relative paths are accepted as a post-login destination (no open redirect). */
function safeNext(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login')) return '/';
  return raw;
}

/**
 * POST { email, password } → sets httpOnly session cookies. Tokens are never returned to the browser.
 * Accepts JSON (the login page's fetch) and, as a no-JS fallback, a regular form post (303 redirects).
 */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return csrfRejected();
  const isForm = (req.headers.get('content-type') ?? '').includes('application/x-www-form-urlencoded');
  let email = '';
  let password = '';
  let next = '/';
  try {
    const body = isForm ? Object.fromEntries(new URLSearchParams(await req.text())) : ((await req.json()) as Record<string, unknown>);
    email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    password = typeof body.password === 'string' ? body.password : '';
    next = safeNext(body.next);
  } catch {
    /* fall through to validation */
  }

  const fail = (status: number, code: string, message: string) => {
    if (!isForm) return NextResponse.json({ error: { code, message } }, { status });
    const url = new URL('/login', req.url);
    url.searchParams.set('error', code);
    if (next !== '/') url.searchParams.set('next', next);
    return NextResponse.redirect(url, 303);
  };

  if (!email || !password || email.length > 200 || password.length > 200) return fail(400, 'VALIDATION_FAILED', 'Email and password are required');
  try {
    const tokens = await passwordLogin(email, password);
    const res = isForm ? NextResponse.redirect(new URL(next, req.url), 303) : NextResponse.json({ ok: true });
    setSessionCookies(res, tokens);
    return res;
  } catch (e) {
    if (e instanceof AuthFailure) return fail(e.status, e.code, e.message);
    console.error('[auth/login] upstream error', e);
    return fail(502, 'UPSTREAM_UNAVAILABLE', 'Sign-in service unavailable');
  }
}
