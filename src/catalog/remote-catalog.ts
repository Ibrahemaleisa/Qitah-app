import { create } from 'zustand';

import type { Category, Offer, Product, Seller, VehicleMake, VehicleModel } from '@/domain/types';

/**
 * In-memory holder for the REMOTE catalog (remote mode only). Pure state, no I/O: the network
 * hydration lives in `services/remote/catalogSync.ts`. The data accessors in `src/data/*` read
 * from here when `isRemote`, so screens keep calling `getProduct`, `getOffer`, `getSeller`… unchanged.
 */

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
}));

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

export function setCatalogData(data: Partial<CatalogData>, meta: { fetchedAt?: number } = {}) {
  useRemoteCatalog.setState((s) => ({
    ...data,
    status: 'ready',
    error: null,
    fetchedAt: meta.fetchedAt ?? s.fetchedAt,
    version: s.version + 1,
  }));
}

/**
 * Merges live offers (price/stock from `GET /v1/catalog/offers`) into the catalog. Offers that are
 * no longer public (and so missing from the snapshot) are kept, flagged `unavailable`, so a cart line
 * can explain what happened instead of silently disappearing.
 */
export function mergeOffers(live: Offer[]) {
  if (!live.length) return;
  useRemoteCatalog.setState((s) => {
    const byId = new Map(live.map((o) => [o.id, o]));
    const merged = s.offers.map((o) => byId.get(o.id) ?? o);
    const known = new Set(s.offers.map((o) => o.id));
    for (const o of live) if (!known.has(o.id)) merged.push(o);
    return { offers: merged, version: s.version + 1 };
  });
}

/** Marks offers that the server no longer returns at all (deleted) as unavailable. */
export function markOffersMissing(ids: string[]) {
  if (!ids.length) return;
  const missing = new Set(ids);
  useRemoteCatalog.setState((s) => ({
    offers: s.offers.map((o) => (missing.has(o.id) ? { ...o, stock: 0, unavailable: true } : o)),
    version: s.version + 1,
  }));
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
