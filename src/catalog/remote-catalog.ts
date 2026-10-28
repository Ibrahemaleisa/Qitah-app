import { create } from 'zustand';

import type { Category, Offer, Product, Seller, VehicleMake, VehicleModel } from '@/domain/types';

import { ProductCache, type ChangesPayload, type ProductPayload } from './product-cache';

/**
 * In-memory holder for the REMOTE catalog (remote mode only). No network I/O here: hydration lives in
 * `services/remote/catalogSync.ts`. The data accessors in `src/data/*` read from here when `isRemote`, so
 * screens keep calling `getProduct`, `getOffer`, `getSeller`… unchanged.
 *
 * Products/offers/sellers are no longer the whole catalog: they mirror a bounded LRU `productCache`
 * (≤ 500 products, persisted per product) filled on demand (reference, home starter pack, products?ids,
 * search pages, seller pages) and kept fresh with `/v1/catalog/changes`. Reference data (categories,
 * makes/models) is held in full.
 */

/** The one product cache (storage is attached by catalogSync in the app; tests use it in memory). */
export const productCache = new ProductCache({ capacity: 500 });

/** What screens need to know about products they asked for but the cache does not hold (yet). */
export type FetchState = 'loading' | 'missing' | 'error';

/** A home "starter pack" (ids into the cache) per vehicle key. */
export type HomePack = { recommended: string[]; featured: string[]; fetchedAt: number };

export type CatalogStatus = 'idle' | 'loading' | 'ready' | 'error';

export type CatalogData = {
  products: Product[];
  offers: Offer[];
  sellers: Seller[];
  makes: VehicleMake[];
  categories: Category[];
};

/**
 * The signed-in customer's PRIVATE offers (accepted part-request quotes), with their products and
 * sellers. Kept apart from the public snapshot so a catalog refresh never drops them and they never
 * appear in search, listings or product offer lists — only in lookups (`getOffer`/`getProduct`/
 * `getSeller`) used by the cart and checkout.
 */
export type PrivateCatalog = { products: Product[]; offers: Offer[]; sellers: Seller[] };

type CatalogState = CatalogData & {
  private: PrivateCatalog;
  status: CatalogStatus;
  error: { code: string; message: string } | null;
  /** Epoch ms of the last successful full refresh (0 = never). */
  fetchedAt: number;
  /** Bumped on every data change so screens can re-render / re-memo. */
  version: number;
  /** Per product id: being fetched, or known not to exist / failed. Absent = cached or never asked. */
  fetches: Record<string, FetchState>;
  homePacks: Record<string, HomePack>;
  /** Seller page product ids (remote `GET /v1/catalog/sellers/:id`). */
  sellerPages: Record<string, string[]>;
};

export const emptyCatalog: CatalogData = { products: [], offers: [], sellers: [], makes: [], categories: [] };

export const emptyPrivateCatalog: PrivateCatalog = { products: [], offers: [], sellers: [] };

export const useRemoteCatalog = create<CatalogState>()(() => ({
  ...emptyCatalog,
  private: emptyPrivateCatalog,
  status: 'idle',
  error: null,
  fetchedAt: 0,
  version: 0,
  fetches: {},
  homePacks: {},
  sellerPages: {},
}));

/** Copies the cache's current contents into the store (and bumps the version for re-renders). */
export function publishCache(extra: Partial<CatalogState> = {}) {
  const view = productCache.view();
  useRemoteCatalog.setState((s) => ({ ...extra, products: view.products, offers: view.offers, sellers: view.sellers, version: s.version + 1 }));
}

/** Groups flat offers under their products for the cache. */
export function toPayloads(products: Product[], offers: Offer[], partial = false): ProductPayload[] {
  const byProduct = new Map<string, Offer[]>();
  for (const o of offers) byProduct.set(o.productId, [...(byProduct.get(o.productId) ?? []), o]);
  return products.map((product) => ({ product, offers: byProduct.get(product.id) ?? [], partial }));
}

/** Adds fetched products to the cache (cart offers are kept if they vanish) and clears their fetch state. */
export function putProducts(payloads: ProductPayload[], sellers: Seller[], keepOfferIds: Iterable<string> = []) {
  productCache.put(payloads, sellers, { keepOfferIds });
  const done = new Set(payloads.map((p) => p.product.id));
  const fetches = Object.fromEntries(Object.entries(useRemoteCatalog.getState().fetches).filter(([id]) => !done.has(id)));
  publishCache({ fetches });
}

export function setFetchState(ids: string[], state: FetchState | null) {
  if (!ids.length) return;
  useRemoteCatalog.setState((s) => {
    const fetches = { ...s.fetches };
    for (const id of ids) {
      if (state) fetches[id] = state;
      else delete fetches[id];
    }
    return { fetches };
  });
}

export function applyCatalogChanges(c: ChangesPayload, keepOfferIds: Iterable<string> = []) {
  productCache.applyChanges(c, { keepOfferIds });
  publishCache();
}

type Index = {
  version: number;
  products: Map<string, Product>;
  offers: Map<string, Offer>;
  offersByProduct: Map<string, Offer[]>;
  sellers: Map<string, Seller>;
  makes: Map<string, VehicleMake>;
  models: Map<string, VehicleModel>;
};

let index: Index | null = null;

/** Lookup maps, rebuilt lazily when the catalog version changes. */
export function catalogIndex(): Index {
  const s = useRemoteCatalog.getState();
  if (index && index.version === s.version) return index;
  const offersByProduct = new Map<string, Offer[]>();
  for (const o of s.offers) {
    const list = offersByProduct.get(o.productId);
    if (list) list.push(o);
    else offersByProduct.set(o.productId, [o]);
  }
  const products = new Map(s.products.map((p) => [p.id, p]));
  const offers = new Map(s.offers.map((o) => [o.id, o]));
  const sellers = new Map(s.sellers.map((x) => [x.id, x]));
  // Private entries are lookup-only (not in offersByProduct); public data wins on id clashes.
  for (const p of s.private.products) if (!products.has(p.id)) products.set(p.id, p);
  for (const o of s.private.offers) if (!offers.has(o.id)) offers.set(o.id, o);
  for (const x of s.private.sellers) if (!sellers.has(x.id)) sellers.set(x.id, x);
  index = {
    version: s.version,
    products,
    offers,
    offersByProduct,
    sellers,
    makes: new Map(s.makes.map((m) => [m.id, m])),
    models: new Map(s.makes.flatMap((m) => m.models.map((x) => [x.id, x] as const))),
  };
  return index;
}

/**
 * Sets reference data (categories, makes) and/or adds products + offers + sellers to the product cache
 * (merged, not replacing: the cache is bounded and on demand), then marks the catalog ready.
 */
export function setCatalogData(data: Partial<CatalogData>, meta: { fetchedAt?: number } = {}) {
  const { products, offers, sellers, ...reference } = data;
  if (products?.length) productCache.put(toPayloads(products, offers ?? []), sellers ?? []);
  else {
    if (offers?.length) productCache.mergeOffers(offers);
    if (sellers?.length) productCache.upsertSellers(sellers);
  }
  useRemoteCatalog.setState((s) => ({ ...reference, status: 'ready', error: null, fetchedAt: meta.fetchedAt ?? s.fetchedAt }));
  publishCache();
}

/**
 * Merges live offers (price/stock from `GET /v1/catalog/offers`) into the cache. Offers that are no
 * longer public are kept, flagged `unavailable`, so a cart line can explain what happened.
 */
export function mergeOffers(live: Offer[]) {
  if (!live.length) return;
  productCache.mergeOffers(live);
  publishCache();
}

/** Marks offers that the server no longer returns at all (deleted) as unavailable. */
export function markOffersMissing(ids: string[]) {
  if (!ids.length) return;
  productCache.markOffersMissing(ids);
  publishCache();
}

/** True when the offer is one of the customer's private (accepted-quote) offers. */
export function isPrivateOffer(id: string): boolean {
  return useRemoteCatalog.getState().private.offers.some((o) => o.id === id);
}

/**
 * Replaces the private layer with the server's current list. Private offers the cart may still
 * reference but the server no longer returns (expired / sold) are kept, flagged unavailable, so the
 * cart can explain them instead of silently dropping the line.
 */
export function setPrivateCatalog(next: PrivateCatalog, keepMissing: string[] = []) {
  useRemoteCatalog.setState((s) => {
    const returned = new Set(next.offers.map((o) => o.id));
    const keep = new Set(keepMissing);
    const stale = s.private.offers.filter((o) => !returned.has(o.id) && keep.has(o.id)).map((o) => ({ ...o, stock: 0, unavailable: true as const }));
    const staleProducts = s.private.products.filter((p) => stale.some((o) => o.productId === p.id) && !next.products.some((x) => x.id === p.id));
    const staleSellers = s.private.sellers.filter((x) => stale.some((o) => o.sellerId === x.id) && !next.sellers.some((y) => y.id === x.id));
    return {
      private: { products: [...next.products, ...staleProducts], offers: [...next.offers, ...stale], sellers: [...next.sellers, ...staleSellers] },
      version: s.version + 1,
    };
  });
}

/** Adds (or refreshes) private entries, e.g. right after accepting a quote. */
export function addPrivateCatalog(add: PrivateCatalog) {
  useRemoteCatalog.setState((s) => {
    const merge = <T extends { id: string }>(a: T[], b: T[]) => [...a.filter((x) => !b.some((y) => y.id === x.id)), ...b];
    return {
      private: { products: merge(s.private.products, add.products), offers: merge(s.private.offers, add.offers), sellers: merge(s.private.sellers, add.sellers) },
      version: s.version + 1,
    };
  });
}

export function clearPrivateCatalog() {
  useRemoteCatalog.setState((s) => (s.private.offers.length ? { private: emptyPrivateCatalog, version: s.version + 1 } : s));
}

/** Subscribe in components so catalog-derived values recompute after a refresh. */
export function useCatalogVersion(): number {
  return useRemoteCatalog((s) => s.version);
}
