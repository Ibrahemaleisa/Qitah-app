import { isRemote } from '@/config/env';

import { deliveryWindow, estimatedTotal, fastestDelivery, getSeller } from './pricing';
import type { CityId, Condition, DeliveryDestination, Offer } from './types';

export type HighlightKind = 'cheapest' | 'fastest' | 'topRated';

/** `condition` is set when the list mixes conditions, so a badge never compares new against used. */
export type OfferHighlight = { kind: HighlightKind; condition?: Condition };

/**
 * Picks the cheapest (by estimated total), fastest and best-rated seller *within each condition*.
 * A badge is only awarded when the offer is strictly better than the runner-up in its group.
 */
export type HighlightScores = {
  /** Remote: delivered total (item + estimated delivery) so "cheapest" means lowest landed cost. */
  total?: (o: Offer) => number;
  /** Remote: days until arrival from the delivery estimate. */
  speed?: (o: Offer) => number;
};

export function offerHighlights(offers: Offer[], destination: DeliveryDestination = 'home', city?: CityId, scores: HighlightScores = {}): Record<string, OfferHighlight[]> {
  const inStock = offers.filter((o) => o.stock > 0);
  const conditions = [...new Set(inStock.map((o) => o.condition))];
  const mixed = conditions.length > 1;
  const result: Record<string, OfferHighlight[]> = {};

  const total = scores.total ?? ((o: Offer) => estimatedTotal(o, destination, city).total);
  const speed = scores.speed ?? ((o: Offer) => {
    // Remote: carrier ETAs are quoted at checkout, so compare on the seller's dispatch time only.
    if (isRemote) return o.dispatchDays[1];
    const f = fastestDelivery(o, destination, city);
    return f ? deliveryWindow(o, f)[1] : Number.POSITIVE_INFINITY;
  });
  const rating = (o: Offer) => getSeller(o.sellerId)?.rating?.average ?? 0;

  for (const condition of conditions) {
    const group = inStock.filter((o) => o.condition === condition);
    if (group.length < 2) continue;
    const award = (kind: HighlightKind, score: (o: Offer) => number) => {
      const sorted = [...group].sort((a, b) => score(a) - score(b));
      if (score(sorted[0]) < score(sorted[1])) {
        (result[sorted[0].id] ??= []).push({ kind, condition: mixed ? condition : undefined });
      }
    };
    award('cheapest', total);
    award('fastest', speed);
    award('topRated', (o) => -rating(o));
  }
  return result;
}
