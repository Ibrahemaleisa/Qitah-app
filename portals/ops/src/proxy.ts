import { NextResponse, type NextRequest } from 'next/server';

/**
 * Next.js 16 "proxy" (formerly middleware): every page requires a session.
 * Unauthenticated visitors are redirected to /login. API routes enforce auth themselves
 * (/api/proxy returns 401 JSON), so they are excluded by the matcher.
 *
 * This is only a presence check; the API verifies the token on every proxied call and the
 * app shell shows the no-access screen for users without a Qitah platform role.
 */
const ACCESS = 'qops_at';
const REFRESH = 'qops_rt';

export function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl;
  const authed = req.cookies.has(ACCESS) || req.cookies.has(REFRESH);
  if (pathname === '/login') return NextResponse.next();
  if (!authed) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname + search)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api/|_next/|favicon.ico|icon.svg|robots.txt).*)'],
};
