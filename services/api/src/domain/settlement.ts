import type { SettlementCadence } from '@prisma/client';

import { applyBps } from '../lib/money.js';
import { riyadhDate } from './delivery.js';

/**
 * Settlement scheduling and the early-payout reserve (pure).
 *
 * - WEEKLY merchants: one automatic DRAFT per week, on SETTLEMENT_WEEKDAY (Riyadh), covering orders whose return
 *   window has closed.
 * - DAILY merchants: one automatic DRAFT per day. If they are also `trustedForEarlyPayout`, delivered orders are
 *   eligible right after delivery; `reserveBps` of the order's payable is withheld (MERCHANT_RESERVE) and released
 *   once the return window has closed and no return/refund is open. Untrusted DAILY merchants keep the normal
 *   after-window eligibility, just settled daily.
 */

const DAY_MS = 86_400_000;
const RIYADH_OFFSET_MS = 3 * 3600_000;

/** Riyadh weekday 0 (Sunday) … 6 (Saturday). */
export const riyadhWeekday = (now: Date) => new Date(now.getTime() + RIYADH_OFFSET_MS).getUTCDay();

/** The settlement period `now` falls in: its idempotency key and the Riyadh date it started. */
export function settlementPeriod(cadence: SettlementCadence, weekday: number, now: Date): { key: string; startDate: string } {
  if (cadence === 'DAILY') {
    const d = riyadhDate(now);
    return { key: `D:${d}`, startDate: d };
  }
  const back = (riyadhWeekday(now) - weekday + 7) % 7;
  const d = riyadhDate(new Date(now.getTime() - back * DAY_MS));
  return { key: `W:${d}`, startDate: d };
}

/** Next automatic settlement date (Riyadh YYYY-MM-DD): today if this period has not run yet, else the next period. */
export function nextSettlementDate(cadence: SettlementCadence, weekday: number, now: Date, currentPeriodDone: boolean): string {
  if (!currentPeriodDone) return riyadhDate(now);
  if (cadence === 'DAILY') return riyadhDate(now, 1);
  const ahead = (weekday - riyadhWeekday(now) + 7) % 7 || 7;
  return riyadhDate(now, ahead);
}

export const earlyPayout = (m: { settlementCadence: SettlementCadence; trustedForEarlyPayout: boolean }) => m.settlementCadence === 'DAILY' && m.trustedForEarlyPayout;

/** Reserve withheld from an early payout: `reserveBps` of a positive payable (half-up, integer halalas). */
export const reserveFor = (payableHalalas: number, reserveBps: number) => (payableHalalas > 0 ? Math.min(payableHalalas, applyBps(payableHalalas, reserveBps)) : 0);
