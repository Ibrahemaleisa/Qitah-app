/**
 * Remote mode without the full snapshot: the synchronous accessors (`getProduct`, `getOffer`) return
 * cached data, and anything missing is fetched on demand (`products?ids=`, coalesced), refreshed with
 * `/v1/catalog/changes`, and the cart's unknown products are resolved from live offers.
 */
import type { ApiProduct } from '@/api/types';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));

type Mods = {
  client: typeof import('@/api/client');
  sync: typeof import('@/services/remote/catalogSync');
  remote: typeof import('@/catalog/remote-catalog');
  catalog: typeof import('@/data/catalog');
  offers: typeof import('@/data/offers');
};

function loadRemote(): Mods {
  const prev = process.env.EXPO_PUBLIC_API_BASE_URL;
  process.env.EXPO_PUBLIC_API_BASE_URL = 'http://api.test';
  let mods!: Mods;
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- isolateModules needs synchronous require */
    mods = {
      client: require('@/api/client'),
      sync: require('@/services/remote/catalogSync'),
      remote: require('@/catalog/remote-catalog'),
      catalog: require('@/data/catalog'),
      offers: require('@/data/offers'),
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  if (prev === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = prev;
  return mods;
}

function apiProduct(id: string, priceHalalas = 10000, available = 3): ApiProduct {
  return {
    id,
    name: { ar: `قطعة ${id}`, en: `Part ${id}` },
    description: { ar: '', en: '' },
    categoryId: 'brakes',
    brand: 'B',
    origin: 'oem',
    partNumber: `PN-${id}`,
    oemReferences: [],
    specs: [],
    fitment: [],
    art: 'pads',
    keywords: [],
    rating: null,
    offers: [{ id: `o-${id}`, productId: id, sellerId: 's1', priceHalalas, compareAtHalalas: null, available, condition: 'new', warrantyMonths: 0, dispatchDays: [0, 1], originCity: 'riyadh', noteAr: null, noteEn: null }],
  };
}
const apiSeller = { id: 's1', name: { ar: 'تاجر', en: 'Seller' }, city: 'riyadh', verifiedBusiness: true, joinedYear: 2024, rating: null, fulfilledOrders: 0, onTimeRate: null, responseHours: 1, supportsWorkshopDelivery: true, specialty: { ar: '', en: '' } };

/** A fake API: records every URL and answers from a small in-memory catalog. */
function fakeApi(m: Mods, catalog: Record<string, ApiProduct>) {
  const calls: URL[] = [];
  m.client.configureApi({
    baseUrl: 'http://api.test',
    sleep: async () => {},
    fetchImpl: (async (raw: string) => {
      const url = new URL(raw);
      calls.push(url);
      let body: unknown = {};
      if (url.pathname === '/v1/catalog/products') {
        const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean);
        const byOffer = (url.searchParams.get('offerIds') ?? '').split(',').filter(Boolean).map((o) => o.replace(/^o-/, ''));
        const wanted = [...new Set([...ids, ...byOffer])];
        body = { products: wanted.filter((id) => catalog[id]).map((id) => catalog[id]), sellers: [apiSeller], missing: wanted.filter((id) => !catalog[id]) };
      } else if (url.pathname === '/v1/catalog/changes') {
        const ids = (url.searchParams.get('ids') ?? '').split(',');
        body = { serverTime: '2026-10-28T12:00:00.000Z', since: url.searchParams.get('since'), products: ids.filter((id) => id === 'p-1').map(() => apiProduct('p-1', 8000, 1)), sellers: [apiSeller], removed: ids.filter((id) => id === 'p-2') };
      } else if (url.pathname === '/v1/catalog/offers') {
        body = { offers: (url.searchParams.get('ids') ?? '').split(',').map((id) => ({ ...apiProduct(id.replace(/^o-/, '')).offers[0], purchasable: true })) };
      }
      return { ok: true, status: 200, text: async () => JSON.stringify(body) } as Response;
    }) as unknown as typeof fetch,
  });
  return calls;
}

describe('remote catalog without the snapshot', () => {
  it('accessors return cached data; missing products are fetched once, in one batch, then re-render', async () => {
    const m = loadRemote();
    const calls = fakeApi(m, { 'p-1': apiProduct('p-1'), 'p-2': apiProduct('p-2') });
    expect(m.catalog.getProduct('p-1')).toBeUndefined();
    const before = m.remote.useRemoteCatalog.getState().version;
    await Promise.all([m.sync.ensureProducts(['p-1']), m.sync.ensureProducts(['p-2', 'p-1', 'nope'])]);
    const productCalls = calls.filter((u) => u.pathname === '/v1/catalog/products');
    expect(productCalls).toHaveLength(1);
    expect(productCalls[0].searchParams.get('ids')!.split(',').sort()).toEqual(['nope', 'p-1', 'p-2']);
    expect(m.catalog.getProduct('p-1')?.name.en).toBe('Part p-1');
    expect(m.offers.getOffer('o-p-2')?.price).toBe(100);
    expect(m.remote.useRemoteCatalog.getState().version).toBeGreaterThan(before);
    expect(m.remote.useRemoteCatalog.getState().fetches.nope).toBe('missing');
    // Cached and known-missing ids are not refetched.
    await m.sync.ensureProducts(['p-1', 'nope']);
    expect(calls.filter((u) => u.pathname === '/v1/catalog/products')).toHaveLength(1);
  });

  it('foreground refresh asks /changes for the cached ids only and merges price/stock and removals', async () => {
    const m = loadRemote();
    const calls = fakeApi(m, { 'p-1': apiProduct('p-1'), 'p-2': apiProduct('p-2') });
    await m.sync.ensureProducts(['p-1', 'p-2']);
    const changed = await m.sync.refreshChanges();
    expect(changed).toBe(2);
    const req = calls.find((u) => u.pathname === '/v1/catalog/changes')!;
    expect(req.searchParams.get('ids')!.split(',').sort()).toEqual(['p-1', 'p-2']);
    expect(req.searchParams.get('since')).toBeTruthy();
    expect(m.offers.getOffer('o-p-1')).toMatchObject({ price: 80, stock: 1 });
    expect(m.offers.getOffer('o-p-2')).toMatchObject({ stock: 0, unavailable: true });
    expect(m.remote.productCache.since).toBe('2026-10-28T12:00:00.000Z');
    // No snapshot request, ever.
    expect(calls.some((u) => u.pathname === '/v1/catalog/snapshot')).toBe(false);
  });

  it('cart: live offers for products not cached pull those products in', async () => {
    const m = loadRemote();
    const calls = fakeApi(m, { 'p-9': apiProduct('p-9') });
    await m.sync.refreshOffers(['o-p-9']);
    expect(calls.map((u) => u.pathname)).toEqual(['/v1/catalog/offers', '/v1/catalog/products']);
    expect(m.catalog.getProduct('p-9')).toBeDefined();
    expect(m.offers.offersForProduct('p-9').map((o) => o.id)).toEqual(['o-p-9']);
  });

  it('the demo catalog is untouched: demo-mode accessors still read the bundled data', () => {
    const prev = process.env.EXPO_PUBLIC_API_BASE_URL;
    delete process.env.EXPO_PUBLIC_API_BASE_URL;
    let catalog!: typeof import('@/data/catalog');
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- isolateModules needs synchronous require
      catalog = require('@/data/catalog');
    });
    if (prev !== undefined) process.env.EXPO_PUBLIC_API_BASE_URL = prev;
    expect(catalog.getProduct('p-camry-pads-oem')).toBeDefined();
    expect(catalog.allProducts().length).toBeGreaterThan(20);
  });
});
