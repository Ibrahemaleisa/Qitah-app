import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { isRemote } from '@/config/env';
import { getOffer } from '@/data/offers';
import type { CartLine } from '@/domain/types';
import { refreshOffers } from '@/services/remote/catalogSync';
import { useAppStore } from '@/store/app-store';

export const MAX_LINE_QTY = 10;

export type LineIssue = { kind: 'unavailable' } | { kind: 'priceChanged'; from: number; to: number } | { kind: 'reduced'; to: number };

/**
 * Remote mode: refreshes live price/stock for the cart's offers (`GET /v1/catalog/offers?ids=`),
 * clamps quantities to what is available, and reports changed prices / unavailable lines.
 */
export async function refreshCartOffers(): Promise<Record<string, number>> {
  const cart = useAppStore.getState().cart;
  if (!isRemote || !cart.length) return {};
  await refreshOffers(cart.map((l) => l.offerId));
  const reduced: Record<string, number> = {};
  const next: CartLine[] = [];
  for (const l of useAppStore.getState().cart) {
    const o = getOffer(l.offerId);
    if (!o) continue; // The server no longer knows this offer at all.
    const max = Math.min(o.stock, MAX_LINE_QTY);
    if (o.stock > 0 && l.qty > max) {
      reduced[l.offerId] = max;
      next.push({ ...l, qty: max });
    } else next.push(l);
  }
  useAppStore.getState().setCart(next);
  return reduced;
}

export function lineIssues(line: CartLine, reduced: Record<string, number>): LineIssue[] {
  const o = getOffer(line.offerId);
  if (!o || o.unavailable || o.stock <= 0) return [{ kind: 'unavailable' }];
  const issues: LineIssue[] = [];
  if (line.seenPrice != null && Math.abs(line.seenPrice - o.price) >= 0.005) issues.push({ kind: 'priceChanged', from: line.seenPrice, to: o.price });
  if (reduced[line.offerId] != null) issues.push({ kind: 'reduced', to: reduced[line.offerId] });
  return issues;
}

export function useLiveCart() {
  const [state, setState] = useState<'idle' | 'refreshing' | 'error'>('idle');
  const [reduced, setReduced] = useState<Record<string, number>>({});
  const refresh = useCallback(async () => {
    if (!isRemote || !useAppStore.getState().cart.length) return;
    setState('refreshing');
    try {
      setReduced(await refreshCartOffers());
      setState('idle');
    } catch {
      setState('error');
    }
  }, []);
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  return { state, reduced, refresh };
}
