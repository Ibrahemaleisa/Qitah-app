import { API_BASE_URL } from '@/config/env';

import { clearTokens, loadTokens, saveTokens } from './tokens';
import type { ApiErrorBody, TokenPair } from './types';

/**
 * Small typed HTTP client for the Qitah API.
 *
 * - every request has a timeout (AbortController);
 * - idempotent GETs retry with exponential backoff on network errors, timeouts, 429 and 5xx;
 * - every failure is mapped to an `ApiError` with a stable `{ code, message }`;
 * - authenticated calls attach the access token, refresh it once on 401 (single-flight, with
 *   refresh-token rotation) and replay the request.
 */

export type ApiErrorCode = 'NETWORK' | 'TIMEOUT' | 'UNAUTHENTICATED' | 'SESSION_EXPIRED' | 'NOT_CONFIGURED' | 'BAD_RESPONSE' | 'ABORTED' | (string & {});

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly details?: unknown;
  constructor(code: ApiErrorCode, message: string, status = 0, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
  /** True when the server could not be reached at all (offline, DNS, timeout). */
  get isNetwork() {
    return this.code === 'NETWORK' || this.code === 'TIMEOUT';
  }
  toJSON() {
    return { code: this.code, message: this.message };
  }
}

/** Normalises anything thrown into `{ code, message }`. */
export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  if (e instanceof Error) return new ApiError('NETWORK', e.message);
  return new ApiError('NETWORK', String(e));
}

export function mapErrorResponse(status: number, body: unknown): ApiError {
  const err = (body as ApiErrorBody | null)?.error;
  const code = err?.code ?? (status === 401 ? 'UNAUTHENTICATED' : status === 404 ? 'NOT_FOUND' : status >= 500 ? 'SERVER' : `HTTP_${status}`);
  const message = err?.message ?? (typeof body === 'string' && body ? body.slice(0, 200) : `Request failed (${status})`);
  return new ApiError(code, message, status, err?.details);
}

type Config = {
  baseUrl: string;
  fetchImpl: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  timeoutMs: number;
};

const config: Config = {
  baseUrl: API_BASE_URL,
  fetchImpl: (...args) => fetch(...args),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  timeoutMs: 12_000,
};

/** Overrides for tests (or for pointing at another server at runtime). */
export function configureApi(patch: Partial<Config>) {
  Object.assign(config, patch);
}

// ── listeners: connectivity and session
type NetListener = (online: boolean) => void;
const netListeners = new Set<NetListener>();
let lastOnline = true;
function reportOnline(online: boolean) {
  if (online === lastOnline) return;
  lastOnline = online;
  netListeners.forEach((l) => l(online));
}
export function onConnectivityChange(l: NetListener) {
  netListeners.add(l);
  return () => {
    netListeners.delete(l);
  };
}

const sessionListeners = new Set<() => void>();
/** Fired when the refresh token is rejected: the user must sign in again. */
export function onSessionExpired(l: () => void) {
  sessionListeners.add(l);
  return () => {
    sessionListeners.delete(l);
  };
}

// ── token refresh (single flight)
let refreshing: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const tokens = await loadTokens();
    if (!tokens?.refreshToken) return null;
    try {
      const pair = await rawRequest<TokenPair>('POST', '/v1/auth/refresh', { body: { refreshToken: tokens.refreshToken }, retries: 0 });
      const saved = await saveTokens(pair);
      return saved.accessToken;
    } catch (e) {
      const err = toApiError(e);
      // Only a definitive rejection ends the session; a network blip keeps the tokens for later.
      if (!err.isNetwork) {
        await clearTokens();
        sessionListeners.forEach((l) => l());
      }
      return null;
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export async function getAccessToken(): Promise<string | null> {
  const tokens = await loadTokens();
  if (!tokens) return null;
  if (tokens.accessExpiresAt > Date.now()) return tokens.accessToken;
  return refreshAccessToken();
}

// ── core request
export type RequestOptions = {
  body?: unknown;
  /** `required`: attach a token and fail with SESSION_EXPIRED if none. `none`: never attach. */
  auth?: 'none' | 'required';
  timeoutMs?: number;
  /** Retries for GET requests (default 2). Non-GET requests are never retried automatically. */
  retries?: number;
  query?: Record<string, string | number | undefined>;
  /** Cancels the request (and any pending retry); rejects with code `ABORTED`. */
  signal?: AbortSignal;
};

const RETRYABLE = (e: ApiError) => e.isNetwork || e.status === 429 || e.status >= 500;

async function rawRequest<T>(method: string, path: string, opts: RequestOptions & { token?: string | null } = {}): Promise<T> {
  if (!config.baseUrl) throw new ApiError('NOT_CONFIGURED', 'API base URL is not configured');
  const qs = opts.query
    ? Object.entries(opts.query)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  const url = `${config.baseUrl}${path}${qs ? `?${qs}` : ''}`;
  const maxRetries = method === 'GET' ? (opts.retries ?? 2) : 0;

  for (let attempt = 0; ; attempt++) {
    if (opts.signal?.aborted) throw new ApiError('ABORTED', 'Request cancelled');
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, opts.timeoutMs ?? config.timeoutMs);
    const onCallerAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onCallerAbort);
    try {
      const headers: Record<string, string> = { accept: 'application/json' };
      if (opts.body !== undefined) headers['content-type'] = 'application/json';
      if (opts.token) headers.authorization = `Bearer ${opts.token}`;
      let res: Response;
      try {
        res = await config.fetchImpl(url, { method, headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined, signal: controller.signal });
      } catch (e) {
        if (opts.signal?.aborted) throw new ApiError('ABORTED', 'Request cancelled');
        throw timedOut ? new ApiError('TIMEOUT', 'The server took too long to respond') : new ApiError('NETWORK', e instanceof Error ? e.message : 'Network request failed');
      }
      reportOnline(true);
      const text = await res.text();
      let data: unknown = null;
      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          data = text;
        }
      }
      if (!res.ok) throw mapErrorResponse(res.status, data);
      return data as T;
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'ABORTED') throw err;
      if (err.isNetwork) reportOnline(false);
      if (attempt < maxRetries && RETRYABLE(err)) {
        await config.sleep(Math.min(4000, 400 * 2 ** attempt) + Math.floor(Math.random() * 150));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onCallerAbort);
    }
  }
}

export async function request<T>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, opts: RequestOptions = {}): Promise<T> {
  if (opts.auth !== 'required') return rawRequest<T>(method, path, opts);
  let token = await getAccessToken();
  if (!token) throw new ApiError('SESSION_EXPIRED', 'Please sign in again', 401);
  try {
    return await rawRequest<T>(method, path, { ...opts, token });
  } catch (e) {
    const err = toApiError(e);
    if (err.status !== 401) throw err;
    token = await refreshAccessToken();
    if (!token) throw new ApiError('SESSION_EXPIRED', 'Please sign in again', 401);
    return rawRequest<T>(method, path, { ...opts, token });
  }
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PATCH', path, { ...opts, body: body ?? {} }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
};
