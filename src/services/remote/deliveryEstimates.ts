import { useEffect, useMemo } from 'react';
import { create } from 'zustand';

import { toDeliveryEstimate } from '@/api/adapters';
import { catalogApi } from '@/api/endpoints';
import { isRemote } from '@/config/env';
import type { DeliveryEstimate } from '@/domain/deliveredPrice';
import type { CityId } from '@/domain/types';
import { useAppStore } from '@/store/app-store';

/**
 * Delivered-price estimates per (city, offer), fetched from `GET /v1/catalog/delivery-estimates`.
 * Remote mode only. Cached in memory for a few minutes: same-day availability changes at the cutoff.
 */

const TTL_MS = 5 * 60_000;

type Entry = { estimate: DeliveryEstimate | null; fetchedAt: number };
type State = { entries: Record<string, Entry>; inflight: Record<string, true> };

export const useDeliveryEstimateStore = create<State>()(() => ({ entries: {}, inflight: {} }));

const keyOf = (city: string, offerId: string) => `${city}:${offerId}`;

export async function loadDeliveryEstimates(offerIds: string[], city: CityId, now = Date.now()) {
  const { entries, inflight } = useDeliveryEstimateStore.getState();
  const due = [...new Set(offerIds)].filter((id) => {
    const k = keyOf(city, id);
    const e = entries[k];
    return !inflight[k] && (!e || now - e.fetchedAt > TTL_MS);
  });
  if (!due.length) return;
  const mark = (on: boolean) =>
    useDeliveryEstimateStore.setState((s) => {
      const next = { ...s.inflight };
      for (const id of due) {
        if (on) next[keyOf(city, id)] = true;
        else delete next[keyOf(city, id)];
      }
      return { inflight: next };
    });
  mark(true);
  try {
    for (let i = 0; i < due.length; i += 50) {
      const chunk = due.slice(i, i + 50);
      const res = await catalogApi.deliveryEstimates(chunk, city);
      const byId = new Map(res.estimates.map((e) => [e.offerId, toDeliveryEstimate(e)]));
      useDeliveryEstimateStore.setState((s) => {
        const next = { ...s.entries };
        // Offers with no estimate (no carrier lane, not public) are cached as null so we don't refetch in a loop.
        for (const id of chunk) next[keyOf(city, id)] = { estimate: byId.get(id) ?? null, fetchedAt: now };
        return { entries: next };
      });
    }
  } finally {
    mark(false);
  }
}

/** The city delivered-price estimates are computed for: the customer's default (first) address. */
export function useEstimateCity(): CityId | undefined {
  return useAppStore((st) => st.addresses[0]?.city);
}

/**
 * Estimates for these offers in the customer's default city, keyed by offer id. Empty in demo mode,
 * without an address, or while loading — callers then fall back to "shipping calculated at checkout".
 */
export function useDeliveryEstimates(offerIds: string[]): { city: CityId | undefined; estimates: Record<string, DeliveryEstimate | undefined> } {
  const city = useEstimateCity();
  const idsKey = [...new Set(offerIds)].sort().join(',');
  const entries = useDeliveryEstimateStore((s) => s.entries);
  useEffect(() => {
    if (!isRemote || !city || !idsKey) return;
    loadDeliveryEstimates(idsKey.split(','), city).catch(() => {
      // Estimates are an enhancement; the checkout plan still prices everything.
    });
  }, [city, idsKey]);
  const estimates = useMemo(() => {
    const out: Record<string, DeliveryEstimate | undefined> = {};
    if (!city) return out;
    for (const id of idsKey ? idsKey.split(',') : []) out[id] = entries[keyOf(city, id)]?.estimate ?? undefined;
    return out;
  }, [entries, city, idsKey]);
  return { city, estimates };
}

export function clearDeliveryEstimates() {
  useDeliveryEstimateStore.setState({ entries: {}, inflight: {} });
}
