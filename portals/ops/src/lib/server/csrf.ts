import 'server-only';

import type { NextRequest } from 'next/server';

import { serverConfig } from './config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF defence for cookie-authenticated mutations (in addition to SameSite=Strict cookies):
 * the browser-supplied Origin must be this portal. If APP_ORIGIN is configured it is matched exactly;
 * otherwise the Origin host must equal the Host the request was addressed to.
 */
export function isSameOrigin(req: NextRequest): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  const origin = req.headers.get('origin');
  if (!origin || origin === 'null') {
    // Some browsers omit Origin on same-origin requests; Fetch Metadata is a reliable fallback.
    return req.headers.get('sec-fetch-site') === 'same-origin';
  }
  const normalized = origin.replace(/\/+$/, '');
  const { allowedOrigins } = serverConfig();
  if (allowedOrigins.length) return allowedOrigins.includes(normalized);
  let originHost: string;
  try {
    originHost = new URL(normalized).host;
  } catch {
    return false;
  }
  const host = req.headers.get('x-forwarded-host')?.split(',')[0]?.trim() || req.headers.get('host');
  return !!host && originHost === host;
}

export const csrfRejected = () =>
  Response.json({ error: { code: 'CSRF_REJECTED', message: 'Cross-site request rejected' } }, { status: 403 });
