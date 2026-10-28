import { prisma } from '../db.js';
import { freshnessPolicy, staleBefore } from '../domain/freshness.js';
import { qualityComponents, qualityScore, SCORE_WEIGHTS, scorecardWarnings, THRESHOLDS, windowMetrics, type MoFacts, type ReturnFacts } from '../domain/scorecard.js';

/**
 * Merchant scorecards from operational data (see domain/scorecard.ts for definitions and the score formula).
 * Phase 1 scale: one query per fact type over the last 90 days for all requested merchants.
 */
export async function computeScorecards(merchantIds: string[], now = new Date()) {
  if (!merchantIds.length) return new Map<string, Scorecard>();
  const since = new Date(now.getTime() - 90 * 86_400_000);
  const policy = freshnessPolicy();
  const [mos, returns, offers, fresh] = await Promise.all([
    prisma.merchantOrder.findMany({
      where: { merchantId: { in: merchantIds }, order: { paidAt: { gte: since } } },
      select: { merchantId: true, createdAt: true, status: true, acceptedAt: true, readyAt: true, readyBy: true, deliveredAt: true, rejectedReason: true, order: { select: { paidAt: true } } },
    }),
    // Merchant-attributable returns: notAsDescribed, and wrongPart unless covered by the fit guarantee (catalog fault).
    prisma.returnCase.findMany({
      where: { merchantId: { in: merchantIds }, createdAt: { gte: since }, status: { not: 'REJECTED' }, OR: [{ reason: 'notAsDescribed' }, { reason: 'wrongPart', guaranteed: false }] },
      select: { merchantId: true, createdAt: true },
    }),
    prisma.offer.groupBy({ by: ['merchantId'], where: { merchantId: { in: merchantIds }, status: 'ACTIVE', visibility: 'PUBLIC' }, _count: true }),
    prisma.offer.groupBy({ by: ['merchantId'], where: { merchantId: { in: merchantIds }, status: 'ACTIVE', visibility: 'PUBLIC', lastConfirmedAt: { gte: staleBefore(now, policy) } }, _count: true }),
  ]);
  const out = new Map<string, Scorecard>();
  for (const id of merchantIds) {
    const facts: MoFacts[] = mos.filter((m) => m.merchantId === id).map((m) => ({ ...m, paidAt: m.order.paidAt }));
    const bad: ReturnFacts[] = returns.filter((r) => r.merchantId === id);
    const totalOffers = offers.find((o) => o.merchantId === id)?._count ?? 0;
    const freshOffers = fresh.find((o) => o.merchantId === id)?._count ?? 0;
    const freshnessRate = totalOffers ? freshOffers / totalOffers : null;
    const d30 = windowMetrics(30, now, facts, bad);
    const d90 = windowMetrics(90, now, facts, bad);
    out.set(id, {
      merchantId: id,
      generatedAt: now.toISOString(),
      d30,
      d90,
      offers: { active: totalOffers, fresh: freshOffers, stale: totalOffers - freshOffers, freshnessRate, staleAfterDays: policy.staleDays, hiddenAfterDays: policy.hideDays },
      qualityScore: qualityScore(d90, freshnessRate),
      components: qualityComponents(d90, freshnessRate),
      weights: SCORE_WEIGHTS,
      thresholds: THRESHOLDS,
      warnings: scorecardWarnings(d30, freshnessRate),
    });
  }
  return out;
}

export type Scorecard = {
  merchantId: string;
  generatedAt: string;
  d30: ReturnType<typeof windowMetrics>;
  d90: ReturnType<typeof windowMetrics>;
  offers: { active: number; fresh: number; stale: number; freshnessRate: number | null; staleAfterDays: number; hiddenAfterDays: number };
  qualityScore: number;
  components: ReturnType<typeof qualityComponents>;
  weights: typeof SCORE_WEIGHTS;
  thresholds: typeof THRESHOLDS;
  warnings: ReturnType<typeof scorecardWarnings>;
};

export async function merchantScorecard(merchantId: string, now = new Date()) {
  return (await computeScorecards([merchantId], now)).get(merchantId)!;
}

/** Ops: every approved/suspended merchant, worst score first. */
export async function allScorecards(now = new Date()) {
  const merchants = await prisma.merchant.findMany({ where: { status: { in: ['APPROVED', 'SUSPENDED'] } }, select: { id: true, displayNameAr: true, displayNameEn: true, status: true, city: true, settlementCadence: true, trustedForEarlyPayout: true } });
  const cards = await computeScorecards(merchants.map((m) => m.id), now);
  return merchants.map((m) => ({ merchant: m, ...cards.get(m.id)! })).sort((a, b) => a.qualityScore - b.qualityScore);
}

/**
 * Recomputes and caches Merchant.qualityScore (used by offer presentation and ordering without per-request scorecard
 * queries). Idempotent; only changed scores are written.
 */
export async function refreshQualityScores(now = new Date()) {
  const merchants = await prisma.merchant.findMany({ where: { status: { in: ['APPROVED', 'SUSPENDED'] } }, select: { id: true, qualityScore: true } });
  const cards = await computeScorecards(merchants.map((m) => m.id), now);
  let changed = 0;
  for (const m of merchants) {
    const score = cards.get(m.id)!.qualityScore;
    if (score === m.qualityScore) continue;
    await prisma.merchant.update({ where: { id: m.id }, data: { qualityScore: score, qualityScoreAt: now } });
    changed++;
  }
  return changed;
}
