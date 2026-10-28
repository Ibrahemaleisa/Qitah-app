import AsyncStorage from '@react-native-async-storage/async-storage';

import { toCategory, toMake, toOffer, toProduct, toSeller } from '@/api/adapters';
import { toApiError } from '@/api/client';
import { catalogApi } from '@/api/endpoints';
import type { ApiProduct, ApiSeller, ReferenceResponse } from '@/api/types';
import { getOffer } from '@/data/offers';
import {
  applyCatalogChanges,
  isPrivateOffer,
  markOffersMissing,
  mergeOffers,
  productCache,
  putProducts,
  setCatalogData,
  setFetchState,
  useRemoteCatalog,
  type CatalogData,
} from '@/catalog/remote-catalog';
import type { ProductPayload } from '@/catalog/product-cache';
import type { Offer, Vehicle } from '@/domain/types';
import { useAppStore } from '@/store/app-store';

import { syncPrivateOffers } from './partRequests';

/**
 * Remote catalog hydration, ON DEMAND and BOUNDED (the full `/v1/catalog/snapshot` is no longer used):
 * - reference data (categories, makes/models) from `GET /v1/catalog/reference`, kept on device (small);
 * - a bounded product cache (`productCache`, LRU ≤ 500, one storage row per product) filled from the home
 *   starter pack (`/v1/catalog/home`), `products?ids=` for favorites / recently viewed / cart, search
 *   pages, seller pages and product detail when a screen asks for something not cached;
 * - kept fresh on foreground with `/v1/catalog/changes` (deltas for the cached ids only), never by
 *   refetching everything. Private (accepted-quote) offers keep their own layer (services/remote/partRequests).
 */

export const CATALOG_STALE_MS = 60_000;
const HOME_STALE_MS = 5 * 60_000;
const REFERENCE_KEY = 'qitah-reference-v2';
/** The old single-blob snapshot cache (could exceed Android's ~2 MB row limit): deleted on boot. */
const LEGACY_SNAPSHOT_KEY = 'qitah-remote-catalog-v1';
const BATCH = 100;

let storageAttached = false;
function attachStorage() {
  if (storageAttached) return;
  storageAttached = true;
  productCache.setStorage(AsyncStorage);
  // Never evict what the customer's cart or favorites point at.
  productCache.setPinned(() => {
    const s = useAppStore.getState();
    const ids = new Set(s.favorites);
    for (const l of s.cart) {
      const o = getOffer(l.offerId);
      if (o) ids.add(o.productId);
    }
    return ids;
  });
}

const cartOfferIds = () => useAppStore.getState().cart.map((l) => l.offerId);

function artFor() {
  return new Map(useRemoteCatalog.getState().categories.map((c) => [c.id as string, c.art]));
}

export function apiPayloads(products: ApiProduct[], partial = false): ProductPayload[] {
  const arts = artFor();
  return products.map((p) => ({ product: toProduct(p, arts.get(p.categoryId)), offers: (p.offers ?? []).map(toOffer), partial }));
}

/** Adds API products (+ sellers) to the cache. `partial` = no seller payloads came with them (search pages). */
export function cacheApiProducts(products: ApiProduct[], sellers: ApiSeller[] = [], partial = false) {
  if (!products.length && !sellers.length) return;
  putProducts(apiPayloads(products, partial), sellers.map(toSeller), cartOfferIds());
}

/** Maps reference data + a list of API products (any endpoint's shape) onto the app's catalog types. */
export function buildCatalog(reference: ReferenceResponse, page: { products?: ApiProduct[]; sellers?: ApiSeller[] }): CatalogData {
  const categories = (reference.categories ?? []).map(toCategory);
  const arts = new Map(categories.map((c) => [c.id as string, c.art]));
  return {
    categories,
    makes: (reference.makes ?? []).map(toMake),
    products: (page.products ?? []).map((p) => toProduct(p, arts.get(p.categoryId))),
    offers: (page.products ?? []).flatMap((p) => (p.offers ?? []).map(toOffer)),
    sellers: (page.sellers ?? []).map(toSeller),
  };
}

function referenceToCatalog(reference: ReferenceResponse): Pick<CatalogData, 'categories' | 'makes'> {
  return { categories: (reference.categories ?? []).map(toCategory), makes: (reference.makes ?? []).map(toMake) };
}

// ───────────────────────────────────────────── boot

/** Restores reference data and the product cache from the device so the UI renders before the network answers. */
export async function loadCachedCatalog(): Promise<boolean> {
  attachStorage();
  AsyncStorage.removeItem(LEGACY_SNAPSHOT_KEY).catch(() => {});
  let hasReference = false;
  try {
    const raw = await AsyncStorage.getItem(REFERENCE_KEY);
    const parsed = raw ? (JSON.parse(raw) as { reference: ReferenceResponse }) : null;
    if (parsed?.reference?.makes?.length && !useRemoteCatalog.getState().makes.length) {
      // fetchedAt 0 → stale, so the network refresh starts immediately.
      setCatalogData(referenceToCatalog(parsed.reference), { fetchedAt: 0 });
      hasReference = true;
    }
  } catch {
    // no usable cached reference
  }
  try {
    if (await productCache.load()) setCatalogData({});
  } catch {
    // a broken cache only costs a refetch
  }
  return hasReference;
}

let inflight: Promise<void> | null = null;

/**
 * Boot / retry: reference data, then (in parallel, best effort) the home starter pack for the selected
 * vehicle and the products the customer's favorites, recently viewed and cart point at. Only a missing
 * reference (nothing to show at all) becomes the error screen.
 */
export function hydrateCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    attachStorage();
    const hasReference = useRemoteCatalog.getState().makes.length > 0;
    if (!hasReference) useRemoteCatalog.setState({ status: 'loading', error: null });
    try {
      const reference = await catalogApi.reference();
      setCatalogData(referenceToCatalog(reference), { fetchedAt: Date.now() });
      AsyncStorage.setItem(REFERENCE_KEY, JSON.stringify({ savedAt: Date.now(), reference })).catch(() => {});
    } catch (e) {
      const err = toApiError(e);
      useRemoteCatalog.setState((s) => ({ status: s.makes.length ? 'ready' : 'error', error: { code: String(err.code), message: err.message } }));
      return;
    }
    const s = useAppStore.getState();
    const vehicle = s.vehicles.find((v) => v.id === s.selectedVehicleId);
    await Promise.allSettled([fetchHomePack(vehicle), ensureProducts([...s.favorites, ...s.recentlyViewed]), ensureProductsForOffers(cartOfferIds()), refreshChanges()]);
  })().finally(() => {
    inflight = null;
  });
  return inflight;
}

// ───────────────────────────────────────────── on demand

const pending = new Set<string>();
let queued = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let waiters: (() => void)[] = [];

/**
 * Makes sure these products are cached: missing ids are fetched in batches of 100 via
 * `GET /v1/catalog/products?ids=` (calls within one tick are coalesced). Resolves when they arrived (or
 * were reported missing / failed: see `fetches` in the store).
 */
export function ensureProducts(ids: string[]): Promise<void> {
  attachStorage();
  const state = useRemoteCatalog.getState();
  const need = [...new Set(ids)].filter((id) => id && !productCache.has(id) && !pending.has(id) && state.fetches[id] !== 'missing');
  if (!need.length) return Promise.resolve();
  for (const id of need) queued.add(id);
  setFetchState(need, 'loading');
  return new Promise<void>((resolve) => {
    waiters.push(resolve);
    if (!flushTimer) flushTimer = setTimeout(flushQueue, 10);
  });
}

async function flushQueue() {
  flushTimer = null;
  const ids = [...queued];
  queued = new Set();
  const done = waiters;
  waiters = [];
  for (const id of ids) pending.add(id);
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += BATCH) chunks.push(ids.slice(i, i + BATCH));
  await Promise.all(
    chunks.map(async (chunk) => {
      try {
        const res = await catalogApi.products(chunk);
        cacheApiProducts(res.products ?? [], res.sellers ?? []);
        const returned = new Set((res.products ?? []).map((p) => p.id));
        setFetchState(chunk.filter((id) => !returned.has(id)), 'missing');
      } catch {
        setFetchState(chunk, 'error');
      } finally {
        for (const id of chunk) pending.delete(id);
      }
    }),
  );
  done.forEach((r) => r());
}

/** The cart only stores offer ids: fetch the products behind public offers we do not hold yet. */
export async function ensureProductsForOffers(offerIds: string[]): Promise<void> {
  attachStorage();
  const need = [...new Set(offerIds)].filter((id) => id && !getOffer(id) && !isPrivateOffer(id));
  for (let i = 0; i < need.length; i += BATCH) {
    try {
      const res = await catalogApi.products([], need.slice(i, i + BATCH));
      cacheApiProducts(res.products ?? [], res.sellers ?? []);
    } catch {
      // the cart shows the line as loading / unavailable; the next refresh retries
    }
  }
}

/** A search page's product held without its sellers: load the full detail (product + sellers) once. */
export async function ensureProductDetail(id: string): Promise<void> {
  const entry = productCache.get(id);
  if (entry && !entry.partial) return;
  if (!entry) return ensureProducts([id]);
  if (pending.has(id)) return;
  pending.add(id);
  try {
    const res = await catalogApi.product(id);
    cacheApiProducts([res.product], res.sellers ?? []);
  } catch {
    // keep the partial entry
  } finally {
    pending.delete(id);
  }
}

function homeKey(v?: Pick<Vehicle, 'modelId' | 'year' | 'engine'>) {
  return v ? `${v.modelId}:${v.year}:${v.engine ?? ''}` : '-';
}

export function homePackFor(v?: Pick<Vehicle, 'modelId' | 'year' | 'engine'>) {
  return useRemoteCatalog.getState().homePacks[homeKey(v)];
}

/** The per-vehicle starter pack (recommended fits + featured), ≤24 products, cached and CDN-cacheable. */
export async function fetchHomePack(v?: Pick<Vehicle, 'modelId' | 'year' | 'engine'>, opts: { force?: boolean } = {}) {
  attachStorage();
  const key = homeKey(v);
  const existing = useRemoteCatalog.getState().homePacks[key];
  if (existing && !opts.force && Date.now() - existing.fetchedAt < HOME_STALE_MS) return existing;
  const res = await catalogApi.home(v ? { modelId: v.modelId, year: v.year, engine: v.engine } : undefined);
  cacheApiProducts(res.products ?? [], res.sellers ?? []);
  const pack = { recommended: res.recommended ?? [], featured: res.featured ?? [], fetchedAt: Date.now() };
  useRemoteCatalog.setState((s) => ({ homePacks: { ...s.homePacks, [key]: pack } }));
  return pack;
}

/** Seller page: the seller and the products it offers (server-side, bounded at 100). */
export async function fetchSellerPage(id: string) {
  const res = await catalogApi.seller(id);
  cacheApiProducts(res.products ?? [], res.seller ? [res.seller] : [], false);
  useRemoteCatalog.setState((s) => ({ sellerPages: { ...s.sellerPages, [id]: (res.products ?? []).map((p) => p.id) } }));
}

// ───────────────────────────────────────────── freshness

let lastChangesAt = 0;

/**
 * Deltas for every cached product since the last sync (`GET /v1/catalog/changes`, 100 ids per call):
 * price / stock / status / terms that changed are replaced, removed products flagged unavailable.
 */
export async function refreshChanges(): Promise<number> {
  const ids = productCache.ids();
  lastChangesAt = Date.now();
  if (!ids.length) return 0;
  // No cursor yet (fresh install / first products): everything we hold is at most this old.
  const oldest = Math.min(...ids.map((id) => productCache.get(id)?.fetchedAt ?? Date.now()));
  const since = productCache.since ?? new Date(oldest - 120_000).toISOString();
  let changed = 0;
  let cursor: string | null = null;
  for (let i = 0; i < ids.length; i += BATCH) {
    const res = await catalogApi.changes(since, ids.slice(i, i + BATCH));
    const products = apiPayloads(res.products ?? []);
    applyCatalogChanges({ products, sellers: (res.sellers ?? []).map(toSeller), removed: res.removed ?? [], serverTime: res.serverTime }, cartOfferIds());
    changed += products.length + (res.removed?.length ?? 0);
    if (!cursor || res.serverTime < cursor) cursor = res.serverTime;
  }
  productCache.setCursor(cursor);
  return changed;
}

export function isCatalogStale(now = Date.now()): boolean {
  return now - Math.max(lastChangesAt, useRemoteCatalog.getState().fetchedAt) > CATALOG_STALE_MS;
}

/** Foreground: deltas for what we hold (bounded) + the home pack when old. Never a full refetch. */
export function ensureFreshCatalog(): Promise<void> | undefined {
  if (!useRemoteCatalog.getState().makes.length) return hydrateCatalog();
  if (!isCatalogStale()) return undefined;
  const s = useAppStore.getState();
  const vehicle = s.vehicles.find((v) => v.id === s.selectedVehicleId);
  return Promise.allSettled([refreshChanges(), fetchHomePack(vehicle)]).then(() => undefined);
}

/**
 * Live price/stock for specific offers (cart open, before checkout). Returns the refreshed offers.
 * Offers the server doesn't know any more are flagged unavailable; products we do not hold are fetched.
 */
export async function refreshOffers(ids: string[]): Promise<Offer[]> {
  const all = [...new Set(ids)].filter(Boolean);
  // Private offers (accepted part-request quotes) are not public: they refresh from the account.
  if (all.some(isPrivateOffer)) await syncPrivateOffers();
  const unique = all.filter((id) => !isPrivateOffer(id));
  if (!unique.length) return [];
  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += 50) chunks.push(unique.slice(i, i + 50));
  const results = await Promise.all(chunks.map((c) => catalogApi.offers(c)));
  const live = results.flatMap((r) => r.offers ?? []).map(toOffer);
  mergeOffers(live);
  const returned = new Set(live.map((o) => o.id));
  markOffersMissing(unique.filter((id) => !returned.has(id)));
  const productIds = [...new Set(live.map((o) => o.productId))].filter((id) => !productCache.has(id));
  if (productIds.length) await ensureProducts(productIds);
  return live;
}
