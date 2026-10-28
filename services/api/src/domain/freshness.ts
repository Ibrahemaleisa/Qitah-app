/**
 * Offer freshness policy (stock accuracy is the top supply risk). An offer is:
 * - fresh  while confirmed within FRESHNESS_STALE_DAYS (default 7);
 * - stale  after that: still purchasable, flagged `stale` and ranked below fresh offers;
 * - hidden after FRESHNESS_HIDE_DAYS (default 21): not publicly listed or purchasable until reconfirmed.
 * Confirmation = any stock or price update, a CSV import row, accepting an order for it, or "confirm all".
 *
 * Read from the environment (validated in config.ts) because catalog filters are module-level and have no ctx.
 */

const DAY_MS = 86_400_000;

export type FreshnessPolicy = { staleDays: number; hideDays: number };

function intEnv(name: string, fallback: number) {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

export function freshnessPolicy(): FreshnessPolicy {
  const staleDays = intEnv('FRESHNESS_STALE_DAYS', 7);
  const hideDays = Math.max(staleDays, intEnv('FRESHNESS_HIDE_DAYS', 21));
  return { staleDays, hideDays };
}

export type Freshness = 'fresh' | 'stale' | 'hidden';

export function offerFreshness(lastConfirmedAt: Date, now = new Date(), policy = freshnessPolicy()): Freshness {
  const age = now.getTime() - lastConfirmedAt.getTime();
  if (age > policy.hideDays * DAY_MS) return 'hidden';
  if (age > policy.staleDays * DAY_MS) return 'stale';
  return 'fresh';
}

/** Offers confirmed before this instant are hidden from public listing and purchase. */
export const hiddenBefore = (now = new Date(), policy = freshnessPolicy()) => new Date(now.getTime() - policy.hideDays * DAY_MS);
/** Offers confirmed before this instant are stale. */
export const staleBefore = (now = new Date(), policy = freshnessPolicy()) => new Date(now.getTime() - policy.staleDays * DAY_MS);
/** When a confirmation made at `lastConfirmedAt` turns stale / hidden. */
export const staleAt = (lastConfirmedAt: Date, policy = freshnessPolicy()) => new Date(lastConfirmedAt.getTime() + policy.staleDays * DAY_MS);
export const hiddenAt = (lastConfirmedAt: Date, policy = freshnessPolicy()) => new Date(lastConfirmedAt.getTime() + policy.hideDays * DAY_MS);
