import AsyncStorage from '@react-native-async-storage/async-storage';

import { toCategory, toMake, toOffer, toProduct, toSeller } from '@/api/adapters';
import { toApiError } from '@/api/client';
import { catalogApi } from '@/api/endpoints';
import type { ReferenceResponse, SnapshotResponse } from '@/api/types';
import { isPrivateOffer, markOffersMissing, mergeOffers, setCatalogData, useRemoteCatalog, type CatalogData } from '@/catalog/remote-catalog';
import type { Offer } from '@/domain/types';

import { syncPrivateOffers } from './partRequests';

/**
 * Hydrates the remote catalog from `GET /v1/catalog/reference` + `GET /v1/catalog/snapshot`.
 * The last good snapshot is cached on device so the app opens offline (flagged by the banner) and
 * refreshes in the background when it comes to the foreground or the data is older than 60s.
 *
 * Search no longer filters this snapshot: the search screen calls `GET /v1/catalog/search`
 * (services/remote/search.ts). The snapshot stays, for now, to back product detail, offer comparison,
 * sellers and the cart; replacing it with per-product fetches / deltas is a later step.
 */

export const CATALOG_STALE_MS = 60_000;
const CACHE_KEY = 'qitah-remote-catalog-v1';

export function buildCatalog(reference: ReferenceResponse, snapshot: SnapshotResponse): CatalogData {
  const categories = (reference.categories ?? []).map(toCategory);
  const artFor = new Map(categories.map((c) => [c.id as string, c.art]));
  const products = (snapshot.products ?? []).map((p) => toProduct(p, artFor.get(p.categoryId)));
  const offers = (snapshot.products ?? []).flatMap((p) => (p.offers ?? []).map(toOffer));
  return {
    categories,
    makes: (reference.makes ?? []).map(toMake),
    products,
    offers,
    sellers: (snapshot.sellers ?? []).map(toSeller),
  };
}

let inflight: Promise<void> | null = null;

export function hydrateCatalog(): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    const hasData = useRemoteCatalog.getState().products.length > 0;
    if (!hasData) useRemoteCatalog.setState({ status: 'loading', error: null });
    try {
      const [reference, snapshot] = await Promise.all([catalogApi.reference(), catalogApi.snapshot()]);
      const data = buildCatalog(reference, snapshot);
      setCatalogData(data, { fetchedAt: Date.now() });
      AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data })).catch(() => {});
    } catch (e) {
      const err = toApiError(e);
      // Keep showing cached data if we have it; only an empty catalog becomes an error screen.
      useRemoteCatalog.setState((s) => ({ status: s.products.length ? 'ready' : 'error', error: { code: String(err.code), message: err.message } }));
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** Loads the last cached snapshot (if any) so the UI can render before the network answers. */
export async function loadCachedCatalog(): Promise<boolean> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as { savedAt: number; data: CatalogData };
    if (!parsed?.data?.products?.length) return false;
    if (useRemoteCatalog.getState().products.length) return true;
    // fetchedAt 0 → considered stale, so a refresh starts immediately.
    setCatalogData(parsed.data, { fetchedAt: 0 });
    return true;
  } catch {
    return false;
  }
}

export function isCatalogStale(now = Date.now()): boolean {
  return now - useRemoteCatalog.getState().fetchedAt > CATALOG_STALE_MS;
}

/** Refreshes in the background when older than 60s. */
export function ensureFreshCatalog(): Promise<void> | undefined {
  if (!isCatalogStale()) return undefined;
  return hydrateCatalog();
}

/**
 * Live price/stock for specific offers (cart open, before checkout). Returns the refreshed offers.
 * Offers the server doesn't know any more are flagged unavailable.
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
  return live;
}
