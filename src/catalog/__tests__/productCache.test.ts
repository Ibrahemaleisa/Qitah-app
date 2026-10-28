import { ProductCache, type KeyValueStore } from '@/catalog/product-cache';
import type { Offer, Product, Seller } from '@/domain/types';

/** The bounded remote product cache: LRU eviction, per-product persistence, changes merge. */

const product = (id: string, name = id): Product => ({
  id,
  name: { ar: name, en: name },
  categoryId: 'brakes',
  brand: 'B',
  origin: 'oem',
  partNumber: `PN-${id}`,
  oemReferences: [],
  description: { ar: '', en: '' },
  specs: [],
  fitment: [],
  art: 'pads',
  keywords: [],
  rating: null,
});
const offer = (id: string, productId: string, price = 100, stock = 5, sellerId = 's1'): Offer => ({ id, productId, sellerId, price, stock, condition: 'new', warrantyMonths: 0, dispatchDays: [0, 1], deliveryOptions: [] });
const seller = (id: string): Seller => ({ id, name: { ar: id, en: id }, city: 'riyadh', verifiedBusiness: true, joinedYear: 2024, rating: null, fulfilledOrders: 0, onTimeRate: null, responseHours: 1, supportsWorkshopDelivery: true, specialty: { ar: '', en: '' } });
const payload = (id: string, price = 100) => ({ product: product(id), offers: [offer(`o-${id}`, id, price)] });

/** In-memory AsyncStorage stand-in that records what was written. */
function memoryStore() {
  const data = new Map<string, string>();
  const store: KeyValueStore & { data: Map<string, string>; writes: number } = {
    data,
    writes: 0,
    async getItem(k) {
      return data.get(k) ?? null;
    },
    async multiGet(keys) {
      return keys.map((k) => [k, data.get(k) ?? null] as const);
    },
    async multiSet(pairs) {
      store.writes += 1;
      for (const [k, v] of pairs) data.set(k, v);
    },
    async multiRemove(keys) {
      for (const k of keys) data.delete(k);
    },
  };
  return store;
}

describe('ProductCache — LRU', () => {
  it('evicts the least recently used products beyond capacity; touch and pins protect', () => {
    const pinned = new Set<string>();
    const cache = new ProductCache({ capacity: 3, flushDelayMs: 0, pinned: () => pinned });
    cache.put([payload('a'), payload('b'), payload('c')]);
    cache.touch('a'); // a is now the most recent
    pinned.add('b');
    const evicted = cache.put([payload('d')]);
    expect(evicted).toEqual(['c']);
    expect(cache.ids()).toEqual(['b', 'a', 'd']);
    // Pinned products survive even when they are the oldest.
    cache.put([payload('e'), payload('f')]);
    expect(cache.has('b')).toBe(true);
    expect(cache.size).toBe(3);
    expect(cache.view().products.map((p) => p.id)).toEqual(['b', 'e', 'f']);
  });

  it('a search result (partial, no sellers) never downgrades a complete entry but refreshes its prices', () => {
    const cache = new ProductCache({ flushDelayMs: 0 });
    cache.put([payload('a', 100)], [seller('s1')]);
    cache.put([{ ...payload('a', 90), partial: true }]);
    expect(cache.get('a')?.partial).toBe(false);
    expect(cache.get('a')?.offers[0].price).toBe(90);
    expect(cache.getSeller('s1')?.name.en).toBe('s1');
  });

  it('keeps live offers for products it does not hold (cart refresh before the product loaded)', () => {
    const cache = new ProductCache({ flushDelayMs: 0 });
    cache.mergeOffers([offer('o-x', 'p-x', 50)]);
    expect(cache.view().offers.map((o) => o.id)).toEqual(['o-x']);
    cache.put([{ product: product('p-x'), offers: [offer('o-x', 'p-x', 55)] }]);
    expect(cache.view().offers).toHaveLength(1);
    expect(cache.view().offers[0].price).toBe(55);
  });
});

describe('ProductCache — chunked persistence', () => {
  it('writes one small row per product plus an index, never one blob, and restores the LRU order and cursor', async () => {
    const storage = memoryStore();
    const cache = new ProductCache({ capacity: 500, storage, flushDelayMs: 0 });
    const many = Array.from({ length: 250 }, (_, i) => payload(`p${i}`));
    cache.put(many, [seller('s1')]);
    cache.setCursor('2026-10-28T10:00:00.000Z');
    await cache.flush();
    const productRows = [...storage.data.keys()].filter((k) => k.startsWith('qitah-pc:p:'));
    expect(productRows).toHaveLength(250);
    expect(storage.data.has('qitah-pc:index')).toBe(true);
    expect(storage.data.has('qitah-pc:sellers')).toBe(true);
    // Every row is small (a product, not the catalog): far below Android's ~2 MB row limit.
    expect(Math.max(...[...storage.data.values()].map((v) => v.length))).toBeLessThan(10_000);
    // Batched writes (chunks of 100 pairs), not one call per product.
    expect(storage.writes).toBeLessThanOrEqual(3);

    const restored = new ProductCache({ storage, flushDelayMs: 0 });
    expect(await restored.load()).toBe(250);
    expect(restored.ids().slice(0, 3)).toEqual(['p0', 'p1', 'p2']);
    expect(restored.since).toBe('2026-10-28T10:00:00.000Z');
    expect(restored.getSeller('s1')).toBeDefined();
    expect(restored.get('p7')?.offers[0].id).toBe('o-p7');
  });

  it('only rewrites dirty rows and deletes the rows of evicted products', async () => {
    const storage = memoryStore();
    const cache = new ProductCache({ capacity: 2, storage, flushDelayMs: 0 });
    cache.put([payload('a'), payload('b')]);
    await cache.flush();
    const before = storage.data.get('qitah-pc:p:a');
    cache.put([payload('c')]); // evicts a
    await cache.flush();
    expect(storage.data.has('qitah-pc:p:a')).toBe(false);
    expect(storage.data.has('qitah-pc:p:c')).toBe(true);
    expect(before).toBeDefined();
    expect(JSON.parse(storage.data.get('qitah-pc:index')!).ids).toEqual(['b', 'c']);
  });

  it('survives corrupt rows and an unknown index version', async () => {
    const storage = memoryStore();
    storage.data.set('qitah-pc:index', JSON.stringify({ v: 1, ids: ['a', 'b'], since: null }));
    storage.data.set('qitah-pc:p:a', '{not json');
    storage.data.set('qitah-pc:p:b', JSON.stringify({ v: 1, ...payload('b'), partial: false, fetchedAt: 1 }));
    const cache = new ProductCache({ storage, flushDelayMs: 0 });
    expect(await cache.load()).toBe(1);
    expect(cache.ids()).toEqual(['b']);
    storage.data.set('qitah-pc:index', JSON.stringify({ v: 99, ids: ['b'] }));
    expect(await new ProductCache({ storage }).load()).toBe(0);
  });
});

describe('ProductCache — /v1/catalog/changes merge', () => {
  it('replaces changed products, flags removed ones, keeps vanished cart offers and advances the cursor', () => {
    const cache = new ProductCache({ flushDelayMs: 0 });
    cache.put([
      { product: product('a', 'old name'), offers: [offer('o-a1', 'a', 100), offer('o-a2', 'a', 120)] },
      payload('b'),
      payload('c'),
    ]);
    cache.applyChanges(
      {
        products: [
          { product: product('a', 'new name'), offers: [offer('o-a1', 'a', 95, 2)] }, // o-a2 left the public catalog
          { product: product('zzz'), offers: [] }, // not cached: ignored (changes only for what we hold)
        ],
        sellers: [seller('s9')],
        removed: ['b'],
        serverTime: '2026-10-28T12:00:00.000Z',
      },
      { keepOfferIds: ['o-a2'] },
    );
    const a = cache.get('a')!;
    expect(a.product.name.en).toBe('new name');
    expect(a.offers.find((o) => o.id === 'o-a1')).toMatchObject({ price: 95, stock: 2 });
    expect(a.offers.find((o) => o.id === 'o-a2')).toMatchObject({ stock: 0, unavailable: true });
    expect(cache.get('b')!.offers.every((o) => o.unavailable && o.stock === 0)).toBe(true);
    expect(cache.get('c')!.offers[0].unavailable).toBeUndefined();
    expect(cache.has('zzz')).toBe(false);
    expect(cache.getSeller('s9')).toBeDefined();
    expect(cache.since).toBe('2026-10-28T12:00:00.000Z');
  });
});
