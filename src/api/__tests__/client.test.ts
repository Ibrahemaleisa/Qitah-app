import { ApiError, api, configureApi, mapErrorResponse, onSessionExpired, toApiError } from '@/api/client';
import { clearTokens, loadTokens, resetTokenCacheForTests, saveTokens } from '@/api/tokens';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

type Call = { url: string; init: RequestInit };

function mockFetch(responses: (Response | Error | ((call: Call) => Response | Error | Promise<Response>))[]) {
  const calls: Call[] = [];
  const impl = jest.fn(async (url: string, init: RequestInit) => {
    const call = { url, init };
    calls.push(call);
    const next = responses.shift();
    if (!next) throw new Error('unexpected request');
    const r = typeof next === 'function' ? await next(call) : next;
    if (r instanceof Error) throw r;
    return r;
  });
  configureApi({ baseUrl: 'http://api.test', fetchImpl: impl as unknown as typeof fetch, sleep: async () => {} });
  return calls;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(async () => {
  resetTokenCacheForTests();
  await clearTokens();
});

describe('error mapping', () => {
  it('maps the API error envelope to { code, message }', () => {
    const e = mapErrorResponse(409, { error: { code: 'PLAN_EXPIRED', message: 'Prices expired' } });
    expect(e.toJSON()).toEqual({ code: 'PLAN_EXPIRED', message: 'Prices expired' });
    expect(e.status).toBe(409);
  });

  it('falls back to stable codes when the body is not an envelope', () => {
    expect(mapErrorResponse(401, null).code).toBe('UNAUTHENTICATED');
    expect(mapErrorResponse(503, 'oops').code).toBe('SERVER');
    expect(mapErrorResponse(418, null).code).toBe('HTTP_418');
    expect(toApiError(new TypeError('Failed to fetch')).code).toBe('NETWORK');
  });
});

describe('retries', () => {
  it('retries idempotent GETs on network errors and 5xx, then succeeds', async () => {
    const calls = mockFetch([new TypeError('offline'), json(503, {}), json(200, { ok: true })]);
    await expect(api.get('/v1/catalog/reference')).resolves.toEqual({ ok: true });
    expect(calls).toHaveLength(3);
  });

  it('gives up after the retry budget with a NETWORK error', async () => {
    mockFetch([new TypeError('offline'), new TypeError('offline'), new TypeError('offline')]);
    await expect(api.get('/v1/catalog/reference')).rejects.toMatchObject({ code: 'NETWORK' });
  });

  it('never retries a POST (checkout must not be duplicated by the client)', async () => {
    const calls = mockFetch([json(503, {})]);
    await expect(api.post('/v1/checkout', { planId: 'x' })).rejects.toBeInstanceOf(ApiError);
    expect(calls).toHaveLength(1);
  });

  it('does not retry client errors', async () => {
    const calls = mockFetch([json(404, { error: { code: 'NOT_FOUND', message: 'Order not found' } })]);
    await expect(api.get('/v1/orders/x')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(calls).toHaveLength(1);
  });
});

describe('timeouts', () => {
  it('aborts a hanging request and reports TIMEOUT', async () => {
    configureApi({
      baseUrl: 'http://api.test',
      sleep: async () => {},
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as unknown as typeof fetch,
    });
    await expect(api.post('/v1/checkout', {}, { timeoutMs: 20 })).rejects.toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('auth', () => {
  it('attaches the access token', async () => {
    await saveTokens({ accessToken: 'acc-1', refreshToken: 'ref-1-xxxxxxxxxxxxxxxxxxxx', expiresIn: 900, tokenType: 'Bearer' });
    const calls = mockFetch([json(200, { orders: [] })]);
    await api.get('/v1/orders', { auth: 'required' });
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe('Bearer acc-1');
  });

  it('refreshes once on 401, stores the rotated tokens and replays the request', async () => {
    await saveTokens({ accessToken: 'stale', refreshToken: 'ref-1-xxxxxxxxxxxxxxxxxxxx', expiresIn: 900, tokenType: 'Bearer' });
    const calls = mockFetch([
      json(401, { error: { code: 'UNAUTHENTICATED', message: 'expired' } }),
      json(200, { accessToken: 'fresh', refreshToken: 'ref-2-xxxxxxxxxxxxxxxxxxxx', expiresIn: 900, tokenType: 'Bearer' }),
      json(200, { orders: [1] }),
    ]);
    await expect(api.get('/v1/orders', { auth: 'required' })).resolves.toEqual({ orders: [1] });
    expect(calls[1].url).toBe('http://api.test/v1/auth/refresh');
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ refreshToken: 'ref-1-xxxxxxxxxxxxxxxxxxxx' });
    expect((calls[2].init.headers as Record<string, string>).authorization).toBe('Bearer fresh');
    expect((await loadTokens())?.refreshToken).toBe('ref-2-xxxxxxxxxxxxxxxxxxxx');
  });

  it('ends the session when the refresh token is rejected', async () => {
    await saveTokens({ accessToken: 'stale', refreshToken: 'ref-1-xxxxxxxxxxxxxxxxxxxx', expiresIn: 900, tokenType: 'Bearer' });
    const expired = jest.fn();
    const off = onSessionExpired(expired);
    mockFetch([json(401, {}), json(401, { error: { code: 'UNAUTHENTICATED', message: 'Session expired' } })]);
    await expect(api.get('/v1/orders', { auth: 'required' })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
    expect(expired).toHaveBeenCalledTimes(1);
    expect(await loadTokens()).toBeNull();
    off();
  });

  it('fails fast without a session', async () => {
    mockFetch([]);
    await expect(api.get('/v1/orders', { auth: 'required' })).rejects.toMatchObject({ code: 'SESSION_EXPIRED' });
  });
});
