import { ApiError } from './errors';

/**
 * Browser → BFF client. All calls go to this portal's own origin (/api/proxy/...);
 * the session lives in httpOnly cookies, so there is no token handling here.
 */
export async function api<T>(path: string, init: { method?: string; body?: unknown; signal?: AbortSignal } = {}): Promise<T> {
  const method = init.method ?? (init.body !== undefined ? 'POST' : 'GET');
  let res: Response;
  try {
    res = await fetch(`/api/proxy/${path.replace(/^\/+/, '')}`, {
      method,
      headers: init.body !== undefined || method !== 'GET' ? { 'content-type': 'application/json' } : undefined,
      body: init.body !== undefined ? JSON.stringify(init.body) : method !== 'GET' ? '{}' : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: init.signal,
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK', 'Network error');
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string; details?: unknown } } | undefined)?.error;
    if (res.status === 401 && typeof window !== 'undefined') {
      const next = window.location.pathname + window.location.search;
      window.location.assign(new URL(`/login?next=${encodeURIComponent(next)}`, window.location.origin).href);
    }
    throw new ApiError(res.status, err?.code ?? `HTTP_${res.status}`, err?.message ?? `Request failed (${res.status})`, err?.details);
  }
  return body as T;
}

export const post = <T>(path: string, body: unknown = {}) => api<T>(path, { method: 'POST', body });

export function qs(params: Record<string, string | number | undefined | null | false>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '' && v !== false) u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}

/** Per-dialog idempotency key (stable while the dialog is open, so retries are safe). */
export const newIdempotencyKey = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
