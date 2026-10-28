import { useEffect, useState } from 'react';

import { productCache, useCatalogVersion, useRemoteCatalog } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import { getProduct } from '@/data/catalog';
import type { Product, Vehicle } from '@/domain/types';
import { ensureProductDetail, ensureProducts, fetchHomePack, fetchSellerPage } from '@/services/remote/catalogSync';

/**
 * Screen-side access to the bounded remote catalog. The synchronous accessors (`getProduct`, `getOffer`…)
 * keep working everywhere; these hooks additionally FETCH what the cache does not hold and re-render when
 * it arrives, exposing a status for skeletons. In demo mode they simply return the bundled data.
 */

export type LoadStatus = 'ready' | 'loading' | 'missing' | 'error';

/** One product: cached → ready immediately (a search-page entry also loads its sellers in the background). */
export function useProduct(id: string | undefined): { product: Product | undefined; status: LoadStatus } {
  useCatalogVersion();
  const fetch = useRemoteCatalog((s) => (id ? s.fetches[id] : undefined));
  const product = id ? getProduct(id) : undefined;
  const cached = !!product;
  useEffect(() => {
    if (!isRemote || !id) return;
    if (!productCache.has(id)) {
      // Private (accepted-quote) products live in their own layer; only fetch what nobody holds.
      if (!cached) ensureProducts([id]);
    } else if (productCache.get(id)?.partial) ensureProductDetail(id);
  }, [id, cached]);
  if (product) return { product, status: 'ready' };
  if (!isRemote || !id) return { product: undefined, status: 'missing' };
  return { product: undefined, status: fetch === 'missing' ? 'missing' : fetch === 'error' ? 'error' : 'loading' };
}

/** Several products (favorites, recently viewed): fetches the missing ones in one batch; `loading` while any is in flight. */
export function useProducts(ids: string[]): { loading: boolean } {
  useCatalogVersion();
  const key = ids.join(',');
  const loading = useRemoteCatalog((s) => isRemote && ids.some((id) => s.fetches[id] === 'loading'));
  useEffect(() => {
    if (!isRemote || !key) return;
    ensureProducts(key.split(','));
  }, [key]);
  return { loading };
}

/** Home starter pack for the vehicle (remote): ids into the cache plus a loading flag. */
export function useHomePack(vehicle: Vehicle | undefined): { recommended: string[]; featured: string[]; loading: boolean } {
  useCatalogVersion();
  const pack = useRemoteCatalog((s) => s.homePacks[vehicle ? `${vehicle.modelId}:${vehicle.year}:${vehicle.engine ?? ''}` : '-']);
  const key = vehicle ? `${vehicle.modelId}:${vehicle.year}:${vehicle.engine ?? ''}` : '-';
  const [failed, setFailed] = useState<string | null>(null);
  useEffect(() => {
    if (!isRemote) return;
    let alive = true;
    fetchHomePack(vehicle).catch(() => alive && setFailed(key));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the vehicle's identity, not the object
  }, [key]);
  return { recommended: pack?.recommended ?? [], featured: pack?.featured ?? [], loading: isRemote && !pack && failed !== key };
}

/** Seller page products (remote): server-side list, bounded. */
export function useSellerProducts(id: string | undefined): { productIds: string[] | undefined; status: LoadStatus } {
  useCatalogVersion();
  const ids = useRemoteCatalog((s) => (id ? s.sellerPages[id] : undefined));
  const [status, setStatus] = useState<LoadStatus>(ids ? 'ready' : 'loading');
  useEffect(() => {
    if (!isRemote || !id) return;
    let alive = true;
    fetchSellerPage(id)
      .then(() => alive && setStatus('ready'))
      .catch(() => alive && setStatus((s) => (s === 'ready' ? s : 'error')));
    return () => {
      alive = false;
    };
  }, [id]);
  return { productIds: ids, status: ids ? 'ready' : status };
}
