import { Prisma } from '@prisma/client';

import { prisma, withTx } from '../db.js';
import { riyadhDate } from '../domain/delivery.js';
import { freshnessPolicy, hiddenBefore, staleBefore } from '../domain/freshness.js';
import { audit, emit, notify, type Actor } from './events.js';
import { refreshListingsForMerchant, refreshListingsForOffers } from './listings.js';

const DAY_MS = 86_400_000;

/** "Confirm all stock is accurate": marks the merchant's active public offers (or the given ones) as confirmed now. */
export async function confirmOffers(merchantId: string, actor: Actor, offerIds?: string[]) {
  return withTx(async (tx) => {
    const now = new Date();
    const r = await tx.offer.updateMany({
      where: { merchantId, visibility: 'PUBLIC', status: { in: ['ACTIVE', 'PAUSED'] }, ...(offerIds?.length ? { id: { in: offerIds } } : {}) },
      data: { lastConfirmedAt: now },
    });
    // Reconfirmed offers may become public again (and stop being stale): keep the read model in step.
    if (offerIds?.length) await refreshListingsForOffers(tx, offerIds);
    else await refreshListingsForMerchant(tx, merchantId);
    await audit(tx, actor, { action: 'offers.confirmed', entityType: 'merchant', entityId: merchantId, merchantId, data: { count: r.count, scope: offerIds?.length ? 'selected' : 'all' } });
    await emit(tx, { type: 'offer.updated', entityType: 'merchant', entityId: merchantId, merchantIds: [merchantId], payload: { confirmed: r.count } });
    return { confirmed: r.count, confirmedAt: now.toISOString() };
  });
}

/** Merchant portal banner: how many active offers are fresh / stale / hidden, and when the next ones turn stale. */
export async function freshnessSummary(merchantId: string, now = new Date()) {
  const policy = freshnessPolicy();
  const base = { merchantId, visibility: 'PUBLIC' as const, status: 'ACTIVE' as const };
  const [active, stale, hidden, dueSoon] = await Promise.all([
    prisma.offer.count({ where: base }),
    prisma.offer.count({ where: { ...base, lastConfirmedAt: { lt: staleBefore(now, policy), gte: hiddenBefore(now, policy) } } }),
    prisma.offer.count({ where: { ...base, lastConfirmedAt: { lt: hiddenBefore(now, policy) } } }),
    prisma.offer.count({ where: { ...base, lastConfirmedAt: { gte: staleBefore(now, policy), lt: new Date(staleBefore(now, policy).getTime() + 2 * DAY_MS) } } }),
  ]);
  return { ...policy, active, fresh: active - stale - hidden, stale, hidden, staleWithin48h: dueSoon, freshnessRate: active ? (active - stale - hidden) / active : null };
}

/**
 * Daily reminder to merchants whose active offers are about to go stale (within a day) or already are stale/hidden.
 * Idempotent per merchant and Riyadh day (JobRunMark), so several workers or reruns send at most one reminder a day.
 */
export async function staleOfferReminders(now = new Date()) {
  const policy = freshnessPolicy();
  const warnBefore = new Date(staleBefore(now, policy).getTime() + DAY_MS);
  const rows = await prisma.offer.groupBy({
    by: ['merchantId'],
    where: { visibility: 'PUBLIC', status: 'ACTIVE', lastConfirmedAt: { lt: warnBefore }, merchant: { status: 'APPROVED' } },
    _count: true,
  });
  let sent = 0;
  for (const row of rows) {
    const key = `stale-reminder:${row.merchantId}:${riyadhDate(now)}`;
    try {
      await withTx(async (tx) => {
        await tx.jobRunMark.create({ data: { key, result: { offers: row._count } } });
        const hidden = await tx.offer.count({ where: { merchantId: row.merchantId, visibility: 'PUBLIC', status: 'ACTIVE', lastConfirmedAt: { lt: hiddenBefore(now, policy) } } });
        await notify(tx, {
          audience: 'MERCHANT',
          merchantId: row.merchantId,
          type: 'offers.stale_reminder',
          title: 'أكّد دقة مخزونك',
          body: hidden
            ? `${row._count} عرضاً بحاجة لتأكيد المخزون، منها ${hidden} مخفية عن العملاء. أكّدها بضغطة واحدة لتعود للظهور.`
            : `${row._count} عرضاً لم يُؤكَّد مخزونها منذ ${policy.staleDays} أيام تقريباً. أكّدها حتى لا تتراجع في ترتيب العروض.`,
          data: { offers: row._count, hidden },
        });
      });
      sent++;
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
      throw e;
    }
  }
  return sent;
}
