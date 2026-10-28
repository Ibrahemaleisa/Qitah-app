import type { RateQuote } from '../providers/carrier/types.js';

/**
 * Delivered-price estimates ("السعر واصلاً" + "يصلك اليوم"). Pure functions: the clock is an input.
 * Saudi Arabia is UTC+3 all year (no DST), so Riyadh local time is a fixed offset.
 */

const RIYADH_OFFSET_MIN = 180;
export const DEFAULT_SAME_DAY_CUTOFF_MIN = 14 * 60;

/** Minutes after local midnight in Riyadh. */
export function riyadhMinutes(now: Date): number {
  return (now.getUTCHours() * 60 + now.getUTCMinutes() + RIYADH_OFFSET_MIN) % 1440;
}

/** Riyadh calendar date (YYYY-MM-DD) `days` after `now`. */
export function riyadhDate(now: Date, days = 0): string {
  const local = new Date(now.getTime() + RIYADH_OFFSET_MIN * 60_000 + days * 86_400_000);
  return local.toISOString().slice(0, 10);
}

export const formatCutoff = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** Same-day applies only if the merchant can dispatch today (dispatchDaysMin 0) and the order is placed before the location's cutoff. */
export function sameDayEligible(now: Date, cutoffMinutes: number, dispatchDaysMin: number): boolean {
  return dispatchDaysMin === 0 && riyadhMinutes(now) < cutoffMinutes;
}

export type ServiceEstimate = { service: RateQuote['serviceCode']; amountHalalas: number; etaDaysMin: number; etaDaysMax: number; arrivesBy: string };

export type DeliveryEstimate = {
  cheapest: ServiceEstimate | null;
  fastest: ServiceEstimate | null;
  sameDayAvailable: boolean;
  cutoffLocal: string;
};

/**
 * Cheapest and fastest service for one offer. Days include merchant dispatch; same-day services are
 * dropped when not eligible (so "fastest" never promises a same-day the merchant cannot meet).
 */
export function estimateDelivery(input: {
  rates: RateQuote[];
  dispatchDaysMin: number;
  dispatchDaysMax: number;
  cutoffMinutes: number;
  now: Date;
}): DeliveryEstimate {
  const eligible = sameDayEligible(input.now, input.cutoffMinutes, input.dispatchDaysMin);
  const services: ServiceEstimate[] = input.rates
    .filter((r) => r.serviceCode !== 'sameDay' || eligible)
    .map((r) => {
      const min = r.serviceCode === 'sameDay' ? 0 : input.dispatchDaysMin + r.etaDaysMin;
      const max = r.serviceCode === 'sameDay' ? 0 : input.dispatchDaysMax + r.etaDaysMax;
      return { service: r.serviceCode, amountHalalas: r.amountHalalas, etaDaysMin: min, etaDaysMax: max, arrivesBy: riyadhDate(input.now, max) };
    });
  const cheapest = [...services].sort((a, b) => a.amountHalalas - b.amountHalalas || a.etaDaysMax - b.etaDaysMax)[0] ?? null;
  const fastest = [...services].sort((a, b) => a.etaDaysMax - b.etaDaysMax || a.amountHalalas - b.amountHalalas)[0] ?? null;
  return {
    cheapest,
    fastest,
    sameDayAvailable: services.some((s) => s.service === 'sameDay'),
    cutoffLocal: formatCutoff(input.cutoffMinutes),
  };
}
