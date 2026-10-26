import { NextResponse, type NextRequest } from 'next/server';

import { csrfRejected, isSameOrigin } from '@/lib/server/csrf';
import { clearSessionCookies, readSession, revokeSession } from '@/lib/server/session';

/** POST → revokes the refresh token at the API (local mode) and clears the session cookies. */
export async function POST(req: NextRequest) {
  if (!isSameOrigin(req)) return csrfRejected();
  await revokeSession(readSession(req).refreshToken);
  const res = NextResponse.json({ ok: true });
  clearSessionCookies(res);
  return res;
}
