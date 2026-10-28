import type { Handling } from '@prisma/client';

import type { ParcelGroup, RateQuote } from '../providers/carrier/types.js';

/**
 * Deterministic smart-cart optimizer.
 *
 * Total landed cost = item prices + shipping for every shipping group (+ fees − discounts, none yet).
 * A shipping group is items from ONE pickup location travelling to ONE destination with compatible
 * handling: hazmat and oversized items never share a parcel with other items.
 * No randomness, no floating point money: identical input → identical output.
 */

export type Candidate = {
  offerId: string;
  merchantId: string;
  locationId: string;
  originCity: string;
  priceHalalas: number;
  available: number;
  dispatchDaysMax: number;
  weightGrams: number;
  dimsCm: [number, number, number];
  handling: Handling;
  /** False when this offer cannot go same-day right now (location cutoff passed or merchant cannot dispatch today). */
  sameDayEligible?: boolean;
};

export type LineRequest = {
  /** Stable key for the customer's cart line (e.g. the originally selected offer id). */
  key: string;
  quantity: number;
  selectedOfferId?: string;
  /** Interchangeable offers: same product AND same condition as the customer's choice. */
  candidates: Candidate[];
};

export type Strategy = 'selected' | 'lowest_total' | 'fastest' | 'fewest_shipments';

export type PlannedGroup = {
  locationId: string;
  merchantId: string;
  originCity: string;
  handling: Handling;
  weightGrams: number;
  lines: { key: string; offerId: string; quantity: number; unitPriceHalalas: number }[];
  rate: RateQuote;
  /** Days until delivery = slowest merchant dispatch + carrier transit. */
  etaDaysMin: number;
  etaDaysMax: number;
};

export type PlanOption = {
  strategy: Strategy;
  groups: PlannedGroup[];
  itemsHalalas: number;
  shippingHalalas: number;
  totalHalalas: number;
  shipmentCount: number;
  etaDaysMax: number;
  /** Which strategies produced this identical option (an option may win several). */
  bestFor: Strategy[];
};

export type RateFn = (group: ParcelGroup) => RateQuote[];

const MAX_EXHAUSTIVE = 20_000;

type Assignment = Candidate[];

function groupKey(c: Candidate): string {
  const isolated = c.handling === 'HAZMAT' || c.handling === 'OVERSIZED';
  return isolated ? `${c.locationId}|${c.handling}|${c.offerId}` : `${c.locationId}|MIXED`;
}

function pickRate(rates: RateQuote[], strategy: Strategy): RateQuote | undefined {
  const sorted = [...rates].sort((a, b) =>
    strategy === 'fastest'
      ? a.etaDaysMax - b.etaDaysMax || a.amountHalalas - b.amountHalalas
      : a.amountHalalas - b.amountHalalas || a.etaDaysMax - b.etaDaysMax,
  );
  return sorted[0];
}

function evaluate(requests: LineRequest[], assignment: Assignment, destinationCity: string, rateFn: RateFn, strategy: Strategy): PlanOption | null {
  const buckets = new Map<string, { c: Candidate; req: LineRequest }[]>();
  assignment.forEach((c, i) => {
    const k = groupKey(c);
    const list = buckets.get(k) ?? [];
    list.push({ c, req: requests[i] });
    buckets.set(k, list);
  });
  const groups: PlannedGroup[] = [];
  for (const entries of [...buckets.values()]) {
    const first = entries[0].c;
    const weightGrams = entries.reduce((s, e) => s + e.c.weightGrams * e.req.quantity, 0);
    const maxDims = entries
      .map((e) => [...e.c.dimsCm].sort((a, b) => b - a) as [number, number, number])
      .reduce((m, d) => (d[0] * d[1] * d[2] > m[0] * m[1] * m[2] ? d : m));
    const handling: Handling = entries.some((e) => e.c.handling === 'FRAGILE') && first.handling === 'STANDARD' ? 'FRAGILE' : first.handling;
    const dispatch = Math.max(...entries.map((e) => e.c.dispatchDaysMax));
    const rate = pickRate(
      rateFn({
        originCity: first.originCity,
        destinationCity,
        weightGrams,
        maxDimsCm: maxDims,
        handling,
        itemCount: entries.reduce((s, e) => s + e.req.quantity, 0),
        sameDayEligible: entries.every((e) => e.c.sameDayEligible !== false),
      }),
      strategy,
    );
    if (!rate) return null; // no carrier service for this lane/parcel → assignment infeasible
    groups.push({
      locationId: first.locationId,
      merchantId: first.merchantId,
      originCity: first.originCity,
      handling,
      weightGrams,
      lines: entries.map((e) => ({ key: e.req.key, offerId: e.c.offerId, quantity: e.req.quantity, unitPriceHalalas: e.c.priceHalalas })),
      rate,
      etaDaysMin: Math.min(...entries.map((e) => e.c.dispatchDaysMax)) + rate.etaDaysMin,
      etaDaysMax: dispatch + rate.etaDaysMax,
    });
  }
  groups.sort((a, b) => a.locationId.localeCompare(b.locationId) || a.lines[0].offerId.localeCompare(b.lines[0].offerId));
  const itemsHalalas = assignment.reduce((s, c, i) => s + c.priceHalalas * requests[i].quantity, 0);
  const shippingHalalas = groups.reduce((s, g) => s + g.rate.amountHalalas, 0);
  return {
    strategy,
    groups,
    itemsHalalas,
    shippingHalalas,
    totalHalalas: itemsHalalas + shippingHalalas,
    shipmentCount: groups.length,
    etaDaysMax: Math.max(...groups.map((g) => g.etaDaysMax)),
    bestFor: [strategy],
  };
}

function score(o: PlanOption, strategy: Strategy): number[] {
  switch (strategy) {
    case 'fastest':
      return [o.etaDaysMax, o.totalHalalas, o.shipmentCount];
    case 'fewest_shipments':
      return [o.shipmentCount, o.totalHalalas, o.etaDaysMax];
    default:
      return [o.totalHalalas, o.shipmentCount, o.etaDaysMax];
  }
}

function better(a: PlanOption, b: PlanOption | null, strategy: Strategy): boolean {
  if (!b) return true;
  const sa = score(a, strategy);
  const sb = score(b, strategy);
  for (let i = 0; i < sa.length; i++) if (sa[i] !== sb[i]) return sa[i] < sb[i];
  // Deterministic tie-break on offer ids.
  return signature(a) < signature(b);
}

function signature(o: PlanOption): string {
  return o.groups.flatMap((g) => g.lines.map((l) => `${l.key}:${l.offerId}`)).sort().join(',') + '|' + o.groups.map((g) => g.rate.serviceCode).join(',');
}

function search(requests: LineRequest[], options: Candidate[][], destinationCity: string, rateFn: RateFn, strategy: Strategy): PlanOption | null {
  const combos = options.reduce((p, o) => p * o.length, 1);
  let best: PlanOption | null = null;
  if (combos <= MAX_EXHAUSTIVE) {
    const walk = (i: number, acc: Assignment) => {
      if (i === options.length) {
        const opt = evaluate(requests, acc, destinationCity, rateFn, strategy);
        if (opt && better(opt, best, strategy)) best = opt;
        return;
      }
      for (const c of options[i]) walk(i + 1, [...acc, c]);
    };
    walk(0, []);
    return best;
  }
  // Large carts: coordinate descent from the cheapest assignment (deterministic, converges).
  let current: Assignment = options.map((o) => o[0]);
  best = evaluate(requests, current, destinationCity, rateFn, strategy);
  for (let round = 0; round < 10; round++) {
    let improved = false;
    for (let i = 0; i < options.length; i++) {
      for (const c of options[i]) {
        const trial = [...current];
        trial[i] = c;
        const opt = evaluate(requests, trial, destinationCity, rateFn, strategy);
        if (opt && better(opt, best, strategy)) {
          best = opt;
          current = trial;
          improved = true;
        }
      }
    }
    if (!improved) break;
  }
  return best;
}

export type OptimizeResult = {
  options: PlanOption[];
  /** Lines with no purchasable offer for the requested quantity. */
  unavailable: string[];
};

export function optimizeCart(requests: LineRequest[], destinationCity: string, rateFn: RateFn): OptimizeResult {
  const feasible = requests.map((r) =>
    r.candidates
      .filter((c) => c.available >= r.quantity && Number.isSafeInteger(c.priceHalalas) && c.priceHalalas > 0)
      .sort((a, b) => a.priceHalalas - b.priceHalalas || a.dispatchDaysMax - b.dispatchDaysMax || a.offerId.localeCompare(b.offerId)),
  );
  const unavailable = requests.filter((_, i) => feasible[i].length === 0).map((r) => r.key);
  if (unavailable.length) return { options: [], unavailable };

  const results: PlanOption[] = [];
  const selected = requests.map((r, i) => feasible[i].find((c) => c.offerId === r.selectedOfferId));
  if (selected.every(Boolean)) {
    const opt = evaluate(requests, selected as Candidate[], destinationCity, rateFn, 'selected');
    if (opt) results.push(opt);
  }
  for (const strategy of ['lowest_total', 'fastest', 'fewest_shipments'] as const) {
    const opt = search(requests, feasible, destinationCity, rateFn, strategy);
    if (!opt) continue;
    const same = results.find((r) => signature(r) === signature(opt));
    if (same) same.bestFor.push(strategy);
    else results.push(opt);
  }
  return { options: results, unavailable: [] };
}
