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

type CatalogState = CatalogData & {
  status: CatalogStatus;
  error: { code: string; message: string } | null;
  /** Epoch ms of the last successful full refresh (0 = never). */
  fetchedAt: number;
  /** Bumped on every data change so screens can re-render / re-memo. */
  version: number;
};

export const emptyCatalog: CatalogData = { products: [], offers: [], sellers: [], makes: [], categories: [] };

export const useRemoteCatalog = create<CatalogState>()(() => ({
  ...emptyCatalog,
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
  index = {
    version: s.version,
    products: new Map(s.products.map((p) => [p.id, p])),
    offers: new Map(s.offers.map((o) => [o.id, o])),
    offersByProduct,
    sellers: new Map(s.sellers.map((x) => [x.id, x])),
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

/** Subscribe in components so catalog-derived values recompute after a refresh. */
export function useCatalogVersion(): number {
  return useRemoteCatalog((s) => s.version);
}
