/**
 * Merchant scorecard (pure): rolling-window metrics and the 0–100 quality score shown on offers.
 *
 * Metrics (per window, over merchant orders PAID within the window):
 * - acceptanceRate         accepted / (accepted + rejected)
 * - outOfStockRate         rejected for OUT_OF_STOCK / received
 * - cancellationRate       rejected by the merchant (any reason) / received   (customer cancellations are excluded)
 * - onTimeReadyRate        ready by `readyBy` / ready
 * - badReturnRate          wrongPart (merchant-claimed fit, not the fit guarantee) + notAsDescribed returns
 *                          opened in the window (not rejected) / delivered
 * - avgAcceptMinutes       mean(acceptedAt − paidAt)
 * - freshnessRate          ACTIVE public offers confirmed within FRESHNESS_STALE_DAYS / ACTIVE public offers (now)
 *
 * qualityScore = round(100 × Σ wᵢ·cᵢ / Σ wᵢ) over the 90-day metrics, with components cᵢ ∈ [0, 1]:
 *   stock      (w 30) = 1 − min(1, outOfStockRate / 10%)
 *   freshness  (w 20) = freshnessRate
 *   acceptance (w 15) = acceptanceRate
 *   onTime     (w 15) = onTimeReadyRate
 *   returns    (w 10) = 1 − min(1, badReturnRate / 10%)
 *   speed      (w 10) = 1 at ≤ 15 min average acceptance, 0 at ≥ 240 min, linear in between
 * Each order-based component is shrunk toward a neutral prior of 0.8 with the weight of 5 observations:
 *   cᵢ' = (n·cᵢ + 5·0.8) / (n + 5)
 * so a new merchant starts near 80 and a single bad order cannot sink (or a single good one inflate) the score.
 */

export type WindowMetrics = {
  days: number;
  received: number;
  accepted: number;
  rejected: number;
  outOfStockRejected: number;
  ready: number;
  readyOnTime: number;
  delivered: number;
  badReturns: number;
  customerCancelled: number;
  acceptanceRate: number | null;
  outOfStockRate: number | null;
  cancellationRate: number | null;
  onTimeReadyRate: number | null;
  badReturnRate: number | null;
  avgAcceptMinutes: number | null;
};

export type MoFacts = {
  createdAt: Date;
  paidAt: Date | null;
  status: string;
  acceptedAt: Date | null;
  readyAt: Date | null;
  readyBy: Date | null;
  deliveredAt: Date | null;
  rejectedReason: string | null;
};

export type ReturnFacts = { createdAt: Date };

const rate = (num: number, den: number) => (den > 0 ? num / den : null);

export function windowMetrics(days: number, now: Date, orders: MoFacts[], badReturns: ReturnFacts[]): WindowMetrics {
  const since = now.getTime() - days * 86_400_000;
  const mos = orders.filter((m) => m.paidAt && m.paidAt.getTime() >= since);
  const accepted = mos.filter((m) => m.acceptedAt);
  const rejected = mos.filter((m) => m.status === 'REJECTED');
  const oos = rejected.filter((m) => (m.rejectedReason ?? '').startsWith('OUT_OF_STOCK'));
  const ready = mos.filter((m) => m.readyAt);
  const onTime = ready.filter((m) => !m.readyBy || m.readyAt! <= m.readyBy);
  const delivered = mos.filter((m) => m.deliveredAt);
  const returns = badReturns.filter((r) => r.createdAt.getTime() >= since).length;
  const acceptMinutes = accepted.map((m) => (m.acceptedAt!.getTime() - m.paidAt!.getTime()) / 60_000);
  return {
    days,
    received: mos.length,
    accepted: accepted.length,
    rejected: rejected.length,
    outOfStockRejected: oos.length,
    ready: ready.length,
    readyOnTime: onTime.length,
    delivered: delivered.length,
    badReturns: returns,
    customerCancelled: mos.filter((m) => m.status === 'CANCELLED').length,
    acceptanceRate: rate(accepted.length, accepted.length + rejected.length),
    outOfStockRate: rate(oos.length, mos.length),
    cancellationRate: rate(rejected.length, mos.length),
    onTimeReadyRate: rate(onTime.length, ready.length),
    badReturnRate: delivered.length ? Math.min(1, returns / delivered.length) : null,
    avgAcceptMinutes: acceptMinutes.length ? Math.round(acceptMinutes.reduce((a, b) => a + b, 0) / acceptMinutes.length) : null,
  };
}

const PRIOR = 0.8;
const PRIOR_WEIGHT = 5;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const shrink = (value: number | null, n: number) => (value === null || n <= 0 ? PRIOR : (n * value + PRIOR_WEIGHT * PRIOR) / (n + PRIOR_WEIGHT));

export const SCORE_WEIGHTS = { stock: 30, freshness: 20, acceptance: 15, onTime: 15, returns: 10, speed: 10 } as const;

export function qualityComponents(m: WindowMetrics, freshnessRate: number | null) {
  const speedRaw = m.avgAcceptMinutes === null ? null : clamp01(1 - (m.avgAcceptMinutes - 15) / (240 - 15));
  return {
    stock: shrink(m.outOfStockRate === null ? null : 1 - Math.min(1, m.outOfStockRate / 0.1), m.received),
    freshness: freshnessRate ?? PRIOR,
    acceptance: shrink(m.acceptanceRate, m.accepted + m.rejected),
    onTime: shrink(m.onTimeReadyRate, m.ready),
    returns: shrink(m.badReturnRate === null ? null : 1 - Math.min(1, m.badReturnRate / 0.1), m.delivered),
    speed: shrink(speedRaw, m.accepted),
  };
}

export function qualityScore(m90: WindowMetrics, freshnessRate: number | null): number {
  const c = qualityComponents(m90, freshnessRate);
  const keys = Object.keys(SCORE_WEIGHTS) as (keyof typeof SCORE_WEIGHTS)[];
  const total = keys.reduce((s, k) => s + SCORE_WEIGHTS[k], 0);
  return Math.round((100 * keys.reduce((s, k) => s + SCORE_WEIGHTS[k] * c[k], 0)) / total);
}

/** Early-warning thresholds (committee: out-of-stock rejection > 3%, stock freshness < 90%). */
export const THRESHOLDS = { outOfStockRate: 0.03, freshnessRate: 0.9, acceptanceRate: 0.9, onTimeReadyRate: 0.9, badReturnRate: 0.05 } as const;

export type Warning = 'OUT_OF_STOCK_HIGH' | 'FRESHNESS_LOW' | 'ACCEPTANCE_LOW' | 'ON_TIME_LOW' | 'BAD_RETURNS_HIGH';

export function scorecardWarnings(m30: WindowMetrics, freshnessRate: number | null): Warning[] {
  const w: Warning[] = [];
  if (m30.outOfStockRate !== null && m30.outOfStockRate > THRESHOLDS.outOfStockRate) w.push('OUT_OF_STOCK_HIGH');
  if (freshnessRate !== null && freshnessRate < THRESHOLDS.freshnessRate) w.push('FRESHNESS_LOW');
  if (m30.acceptanceRate !== null && m30.acceptanceRate < THRESHOLDS.acceptanceRate) w.push('ACCEPTANCE_LOW');
  if (m30.onTimeReadyRate !== null && m30.onTimeReadyRate < THRESHOLDS.onTimeReadyRate) w.push('ON_TIME_LOW');
  if (m30.badReturnRate !== null && m30.badReturnRate > THRESHOLDS.badReturnRate) w.push('BAD_RETURNS_HIGH');
  return w;
}
