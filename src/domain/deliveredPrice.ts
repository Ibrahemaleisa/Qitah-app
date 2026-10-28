import type { Offer } from './types';

/**
 * Delivered price ("السعر واصلاً") and arrival promise ("يصلك اليوم") shown before the cart.
 * Inputs are server estimates (`GET /v1/catalog/delivery-estimates`) already converted to SAR; they
 * are labelled "تقديري" in the UI because the binding price is the checkout plan.
 */

export type ServiceEstimate = { service: string; fee: number; etaDays: [number, number]; arrivesBy: string };

export type DeliveryEstimate = {
  offerId: string;
  cheapest: ServiceEstimate | null;
  fastest: ServiceEstimate | null;
  sameDayAvailable: boolean;
  cutoffLocal: string;
};

export type DeliveredPrice = {
  /** Item price + cheapest estimated delivery fee (one unit). */
  total: number;
  fee: number;
  /** Earliest arrival over the available services (fastest). */
  arrivesBy: string;
  arrivesToday: boolean;
  service: string;
};

export function deliveredPrice(offer: Pick<Offer, 'price'>, estimate: DeliveryEstimate | undefined): DeliveredPrice | null {
  if (!estimate?.cheapest) return null;
  const fastest = estimate.fastest ?? estimate.cheapest;
  return {
    // Add in halalas so a display total never drifts (19.99 + 15 = 34.99, not 34.989999…).
    total: (Math.round(offer.price * 100) + Math.round(estimate.cheapest.fee * 100)) / 100,
    fee: estimate.cheapest.fee,
    arrivesBy: fastest.arrivesBy,
    arrivesToday: fastest.etaDays[1] === 0,
    service: estimate.cheapest.service,
  };
}

/** Riyadh calendar date (UTC+3, no DST) as YYYY-MM-DD. */
export function riyadhToday(now: number = Date.now()): string {
  return new Date(now + 3 * 3_600_000).toISOString().slice(0, 10);
}

export type ArrivalLabel = { kind: 'today' } | { kind: 'tomorrow' } | { kind: 'weekday'; weekday: number } | { kind: 'date'; date: string };

/** "today" / "tomorrow" / a weekday name within the coming week / a date further out. */
export function arrivalLabel(arrivesBy: string, today: string): ArrivalLabel {
  const days = Math.round((Date.parse(`${arrivesBy}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (days <= 0) return { kind: 'today' };
  if (days === 1) return { kind: 'tomorrow' };
  if (days < 7) return { kind: 'weekday', weekday: new Date(`${arrivesBy}T00:00:00Z`).getUTCDay() };
  return { kind: 'date', date: arrivesBy };
}

/** Sort key for "best price": the lowest delivered total, falling back to the item price when no estimate exists. */
export function deliveredTotal(offer: Offer, estimates: Record<string, DeliveryEstimate | undefined>): number {
  return deliveredPrice(offer, estimates[offer.id])?.total ?? offer.price;
}

/** Best offer = in-stock offer with the lowest delivered total (ties → earlier arrival). */
export function bestDeliveredOffer(offers: Offer[], estimates: Record<string, DeliveryEstimate | undefined>): Offer | undefined {
  const pool = offers.filter((o) => o.stock > 0 && !o.unavailable);
  const arrival = (o: Offer) => deliveredPrice(o, estimates[o.id])?.arrivesBy ?? '9999-12-31';
  return [...(pool.length ? pool : offers)].sort((a, b) => deliveredTotal(a, estimates) - deliveredTotal(b, estimates) || arrival(a).localeCompare(arrival(b)))[0];
}

export const arrivesToday = (estimate: DeliveryEstimate | undefined) => !!estimate?.sameDayAvailable;

/** Days until the fastest estimated arrival (Infinity when unknown). */
export function arrivalDays(offer: Offer, estimates: Record<string, DeliveryEstimate | undefined>): number {
  const e = estimates[offer.id];
  return (e?.fastest ?? e?.cheapest)?.etaDays[1] ?? Number.POSITIVE_INFINITY;
}

/**
 * Scoring for offer comparison once estimates exist: "cheapest" = lowest delivered total, "fastest" = earliest
 * arrival. Empty when there are no estimates, so callers keep their default scoring.
 */
export function deliveredScores(estimates: Record<string, DeliveryEstimate | undefined>): { total?: (o: Offer) => number; speed?: (o: Offer) => number } {
  if (!Object.values(estimates).some((e) => e?.cheapest)) return {};
  return { total: (o) => deliveredTotal(o, estimates), speed: (o) => arrivalDays(o, estimates) };
}
