import { Prisma, type Merchant, type MerchantOrder, type SettlementLineKind } from '@prisma/client';

import type { Ctx } from '../context.js';
import { prisma, withTx, type Tx } from '../db.js';
import { earlyPayout, nextSettlementDate, reserveFor, settlementPeriod } from '../domain/settlement.js';
import { conflict, notFound } from '../lib/errors.js';
import { audit, notify, SYSTEM, type Actor } from './events.js';
import { post } from './ledger.js';
import { repaidForOrder } from './organizations.js';
import { CREDIT_PROVIDER } from './payments.js';

const OPEN_RETURN = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'] as const;

export type EligibleLine = {
  merchantOrder: MerchantOrder;
  kind: SettlementLineKind;
  grossHalalas: number;
  commissionHalalas: number;
  refundsHalalas: number;
  netHalalas: number;
  /** SALE: withheld into MERCHANT_RESERVE (early payout). RESERVE_RELEASE: the reserve being paid out. */
  reserveHalalas: number;
};

/**
 * Settlement eligibility. Amounts come from the ledger, never recomputed from prices.
 *
 * SALE lines — merchant order DELIVERED, no open return case, no pending refund, not yet on a SALE line, and either
 *   - the return window has elapsed (every merchant), or
 *   - the merchant is DAILY + trustedForEarlyPayout (early payout): eligible right after delivery, with
 *     SETTLEMENT_RESERVE_BPS of the payable withheld while the window is still open.
 * RESERVE_RELEASE lines — an early-paid order whose reserve was released (see `releaseReserves`): pays the reserve
 *   minus anything refunded after the early payout (negative when refunds exceeded the reserve; it then offsets other
 *   lines of the same settlement).
 */
export async function eligibleMerchantOrders(ctx: Ctx, merchantId: string, asOf = new Date()): Promise<EligibleLine[]> {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId } });
  if (!merchant) return [];
  const cutoff = new Date(asOf.getTime() - ctx.config.RETURN_WINDOW_DAYS * 86_400_000);
  const early = earlyPayout(merchant);
  const [sales, releases] = await Promise.all([
    prisma.merchantOrder.findMany({
      where: {
        merchantId,
        status: 'DELIVERED',
        deliveredAt: { lte: early ? asOf : cutoff },
        settlementLines: { none: { kind: 'SALE' } },
        returnCases: { none: { status: { in: [...OPEN_RETURN] } } },
        order: { refunds: { none: { status: 'PENDING' } } },
      },
      orderBy: { deliveredAt: 'asc' },
    }),
    prisma.merchantOrder.findMany({
      where: {
        merchantId,
        settlementLines: { some: { kind: 'SALE', reserveHalalas: { gt: 0 } }, none: { kind: 'RESERVE_RELEASE' } },
      },
      include: { settlementLines: { where: { kind: 'SALE' } } },
      orderBy: { deliveredAt: 'asc' },
    }),
  ]);
  const released = releases.length
    ? new Set((await prisma.ledgerPosting.findMany({ where: { type: 'RESERVE_RELEASE', refId: { in: releases.map((m) => m.id) } }, select: { refId: true } })).map((p) => p.refId))
    : new Set<string>();
  const releasable = releases.filter((m) => released.has(m.id));
  const ids = [...sales.map((m) => m.id), ...releasable.map((m) => m.id)];
  if (!ids.length) return [];
  const sums = await prisma.ledgerEntry.groupBy({
    by: ['merchantOrderId', 'account'],
    where: { merchantOrderId: { in: ids }, account: { in: ['MERCHANT_PAYABLE', 'PLATFORM_COMMISSION'] } },
    _sum: { amountHalalas: true },
  });
  const credit = (id: string, account: string) => -(sums.find((s) => s.merchantOrderId === id && s.account === account)?._sum.amountHalalas ?? 0);

  const lines: EligibleLine[] = sales.map((m) => {
    const payable = credit(m.id, 'MERCHANT_PAYABLE');
    const commission = credit(m.id, 'PLATFORM_COMMISSION');
    const withinWindow = !m.deliveredAt || m.deliveredAt > cutoff;
    const reserve = early && withinWindow ? reserveFor(payable, ctx.config.SETTLEMENT_RESERVE_BPS) : 0;
    return {
      merchantOrder: m,
      kind: 'SALE',
      grossHalalas: m.itemsHalalas,
      commissionHalalas: commission,
      refundsHalalas: m.itemsHalalas - commission - payable,
      netHalalas: payable - reserve,
      reserveHalalas: reserve,
    };
  });
  for (const m of releasable) {
    const sale = m.settlementLines[0];
    // The order's payable now includes the released reserve and any refund booked after the early payout.
    const net = credit(m.id, 'MERCHANT_PAYABLE') - sale.netHalalas;
    const { settlementLines: _omit, ...mo } = m;
    void _omit;
    lines.push({ merchantOrder: mo, kind: 'RESERVE_RELEASE', grossHalalas: 0, commissionHalalas: 0, refundsHalalas: sale.reserveHalalas - net, netHalalas: net, reserveHalalas: sale.reserveHalalas });
  }
  return lines;
}

async function createSettlementTx(tx: Tx, actor: Actor, merchantId: string, lines: EligibleLine[], automatic: boolean) {
  const sum = (f: (l: EligibleLine) => number) => lines.reduce((a, l) => a + f(l), 0);
  const s = await tx.settlement.create({
    data: {
      merchantId,
      automatic,
      grossHalalas: sum((l) => l.grossHalalas),
      commissionHalalas: sum((l) => l.commissionHalalas),
      refundsHalalas: sum((l) => l.refundsHalalas),
      netHalalas: sum((l) => l.netHalalas),
      reserveHeldHalalas: sum((l) => (l.kind === 'SALE' ? l.reserveHalalas : 0)),
      reserveReleasedHalalas: sum((l) => (l.kind === 'RESERVE_RELEASE' ? l.reserveHalalas : 0)),
      lines: {
        create: lines.map((l) => ({
          merchantOrderId: l.merchantOrder.id,
          kind: l.kind,
          grossHalalas: l.grossHalalas,
          commissionHalalas: l.commissionHalalas,
          refundsHalalas: l.refundsHalalas,
          netHalalas: l.netHalalas,
          reserveHalalas: l.reserveHalalas,
        })),
      },
    },
    include: { lines: true },
  });
  // Early payout: move the reserve out of the payable so the payout cannot include it (idempotent per order).
  for (const l of lines.filter((x) => x.kind === 'SALE' && x.reserveHalalas > 0)) {
    const ref = { merchantId, merchantOrderId: l.merchantOrder.id };
    await post(tx, {
      type: 'RESERVE_HOLD',
      refType: 'merchant_order',
      refId: l.merchantOrder.id,
      orderId: l.merchantOrder.orderId,
      lines: [
        { account: 'MERCHANT_PAYABLE', amountHalalas: l.reserveHalalas, ...ref },
        { account: 'MERCHANT_RESERVE', amountHalalas: -l.reserveHalalas, ...ref },
      ],
    });
  }
  await audit(tx, actor, { action: automatic ? 'settlement.auto_generated' : 'settlement.generated', entityType: 'settlement', entityId: s.id, merchantId, data: { net: s.netHalalas, reserveHeld: s.reserveHeldHalalas, reserveReleased: s.reserveReleasedHalalas } });
  return s;
}

const settleable = (lines: EligibleLine[]) => lines.length > 0 && lines.reduce((a, l) => a + l.netHalalas, 0) > 0;

export async function generateSettlement(ctx: Ctx, actor: Actor, merchantId: string, asOf?: Date) {
  const lines = await eligibleMerchantOrders(ctx, merchantId, asOf);
  if (!settleable(lines)) throw conflict('NOTHING_TO_SETTLE', 'No merchant orders are eligible for settlement yet');
  return withTx((tx) => createSettlementTx(tx, actor, merchantId, lines, false));
}

export async function approveSettlement(actor: Actor, id: string) {
  return withTx(async (tx) => {
    const s = await tx.settlement.findUnique({ where: { id } });
    if (!s) throw notFound('Settlement');
    if (s.status !== 'DRAFT') throw conflict('INVALID_TRANSITION', `Settlement is ${s.status}`);
    const updated = await tx.settlement.update({ where: { id }, data: { status: 'APPROVED', approvedById: actor.userId, approvedAt: new Date() } });
    await audit(tx, actor, { action: 'settlement.approved', entityType: 'settlement', entityId: id, merchantId: s.merchantId });
    return updated;
  });
}

/** Records an executed bank payout (performed outside Qitah) and clears the merchant payable. */
export async function markSettlementPaid(actor: Actor, id: string, payoutReference: string) {
  return withTx(async (tx) => {
    const s = await tx.settlement.findUnique({ where: { id } });
    if (!s) throw notFound('Settlement');
    if (s.status !== 'APPROVED') throw conflict('INVALID_TRANSITION', `Settlement is ${s.status}`);
    await post(tx, {
      type: 'PAYOUT',
      refType: 'settlement',
      refId: s.id,
      lines: [
        { account: 'MERCHANT_PAYABLE', amountHalalas: s.netHalalas, merchantId: s.merchantId },
        { account: 'PAYOUTS', amountHalalas: -s.netHalalas, merchantId: s.merchantId },
      ],
    });
    const updated = await tx.settlement.update({ where: { id }, data: { status: 'PAID', paidAt: new Date(), payoutReference } });
    await notify(tx, { audience: 'MERCHANT', merchantId: s.merchantId, type: 'settlement.paid', title: 'تم تحويل مستحقاتك', body: `${(s.netHalalas / 100).toFixed(2)} ر.س — مرجع ${payoutReference}`, data: { settlementId: s.id } });
    await audit(tx, actor, { action: 'settlement.paid', entityType: 'settlement', entityId: id, merchantId: s.merchantId, data: { payoutReference } });
    return updated;
  });
}

export async function merchantBalance(merchantId: string) {
  const rows = await prisma.ledgerEntry.groupBy({ by: ['account'], where: { merchantId }, _sum: { amountHalalas: true } });
  const val = (a: string) => rows.find((r) => r.account === a)?._sum.amountHalalas ?? 0;
  return {
    /** Owed to merchant and not yet paid out (credit balance shown positive). Excludes the reserve. */
    payableHalalas: -val('MERCHANT_PAYABLE'),
    commissionHalalas: -val('PLATFORM_COMMISSION'),
    paidOutHalalas: -val('PAYOUTS'),
    /** Withheld from early payouts until the return window closes. */
    reserveHeldHalalas: -val('MERCHANT_RESERVE'),
  };
}

// ───────────────────────────────────────────── automatic settlement (worker)

/**
 * Releases early-payout reserves whose return window has closed and whose returns/refunds are settled
 * (debit MERCHANT_RESERVE, credit MERCHANT_PAYABLE). Idempotent: one RESERVE_RELEASE posting per merchant order.
 */
export async function releaseReserves(ctx: Ctx, now = new Date()) {
  const cutoff = new Date(now.getTime() - ctx.config.RETURN_WINDOW_DAYS * 86_400_000);
  const held = await prisma.settlementLine.findMany({
    where: {
      kind: 'SALE',
      reserveHalalas: { gt: 0 },
      merchantOrder: {
        deliveredAt: { lte: cutoff },
        returnCases: { none: { status: { in: [...OPEN_RETURN] } } },
        order: { refunds: { none: { status: 'PENDING' } } },
        settlementLines: { none: { kind: 'RESERVE_RELEASE' } },
      },
    },
    include: { merchantOrder: true },
    take: 200,
  });
  let released = 0;
  for (const line of held) {
    const mo = line.merchantOrder;
    const done = await withTx(async (tx) => {
      const remaining = await tx.ledgerEntry.aggregate({ where: { merchantOrderId: mo.id, account: 'MERCHANT_RESERVE' }, _sum: { amountHalalas: true } });
      const amount = -(remaining._sum.amountHalalas ?? 0);
      if (amount <= 0) return false;
      const ref = { merchantId: mo.merchantId, merchantOrderId: mo.id };
      return post(tx, {
        type: 'RESERVE_RELEASE',
        refType: 'merchant_order',
        refId: mo.id,
        orderId: mo.orderId,
        lines: [
          { account: 'MERCHANT_RESERVE', amountHalalas: amount, ...ref },
          { account: 'MERCHANT_PAYABLE', amountHalalas: -amount, ...ref },
        ],
      });
    });
    if (done) released++;
  }
  return released;
}

/**
 * Generates one DRAFT settlement per merchant per period (WEEKLY on SETTLEMENT_WEEKDAY, or DAILY), when anything is
 * eligible. Idempotent across runs and workers: the period's JobRunMark is inserted in the same transaction as the
 * settlement, so a period is processed exactly once. Approval and mark-paid stay manual (finance roles).
 */
export async function autoSettlements(ctx: Ctx, now = new Date()) {
  const merchants = await prisma.merchant.findMany({ where: { status: 'APPROVED' }, select: { id: true, settlementCadence: true } });
  let created = 0;
  for (const m of merchants) {
    const period = settlementPeriod(m.settlementCadence, ctx.config.SETTLEMENT_WEEKDAY, now);
    const key = `settlement:${m.id}:${period.key}`;
    if (await prisma.jobRunMark.findUnique({ where: { key } })) continue;
    const lines = await eligibleMerchantOrders(ctx, m.id, now);
    try {
      const s = await withTx(async (tx) => {
        await tx.jobRunMark.create({ data: { key } });
        const settlement = settleable(lines) ? await createSettlementTx(tx, SYSTEM, m.id, lines, true) : null;
        await tx.jobRunMark.update({ where: { key }, data: { result: { settlementId: settlement?.id ?? null, lines: lines.length } } });
        if (settlement) {
          await notify(tx, { audience: 'OPS', type: 'settlement.draft', title: 'تسوية تلقائية بانتظار الاعتماد', body: `${(settlement.netHalalas / 100).toFixed(2)} ر.س — ${lines.length} طلب`, data: { settlementId: settlement.id, merchantId: m.id } });
          await notify(tx, { audience: 'MERCHANT', merchantId: m.id, type: 'settlement.draft', title: 'تسوية جديدة قيد المراجعة', body: `${(settlement.netHalalas / 100).toFixed(2)} ر.س — يتم التحويل بعد اعتماد المالية`, data: { settlementId: settlement.id } });
        }
        return settlement;
      });
      if (s) created++;
    } catch (e) {
      // Another worker processed this period first (mark or line uniqueness): nothing to do.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
      throw e;
    }
  }
  return created;
}

/** Merchant portal "مستحقاتي": next automatic run, what is eligible now, the reserve held, and history. */
export async function payoutOverview(ctx: Ctx, merchant: Pick<Merchant, 'id' | 'settlementCadence' | 'trustedForEarlyPayout'>, now = new Date()) {
  const period = settlementPeriod(merchant.settlementCadence, ctx.config.SETTLEMENT_WEEKDAY, now);
  const done = !!(await prisma.jobRunMark.findUnique({ where: { key: `settlement:${merchant.id}:${period.key}` } }));
  const [eligible, balance, pendingSettlements] = await Promise.all([
    eligibleMerchantOrders(ctx, merchant.id, now),
    merchantBalance(merchant.id),
    prisma.settlement.aggregate({ where: { merchantId: merchant.id, status: { in: ['DRAFT', 'APPROVED'] } }, _sum: { netHalalas: true }, _count: true }),
  ]);
  return {
    cadence: merchant.settlementCadence,
    earlyPayout: earlyPayout(merchant),
    reserveBps: ctx.config.SETTLEMENT_RESERVE_BPS,
    returnWindowDays: ctx.config.RETURN_WINDOW_DAYS,
    nextSettlementDate: nextSettlementDate(merchant.settlementCadence, ctx.config.SETTLEMENT_WEEKDAY, now, done),
    eligibleNetHalalas: eligible.reduce((s, l) => s + l.netHalalas, 0),
    eligibleOrders: eligible.length,
    eligibleReserveHalalas: eligible.filter((l) => l.kind === 'SALE').reduce((s, l) => s + l.reserveHalalas, 0),
    reserveHeldHalalas: balance.reserveHeldHalalas,
    inReviewHalalas: pendingSettlements._sum.netHalalas ?? 0,
    inReviewSettlements: pendingSettlements._count,
  };
}

// ───────────────────────────────────────────── reconciliation & margins

type OrderForMargin = Prisma.OrderGetPayload<{ include: { payments: true; refunds: true; shipments: true } }>;

/**
 * Contribution margin of one order (platform view, after refunds):
 *   commission (net PLATFORM_COMMISSION, after reversals and discounts)
 * + shipping margin (shipping the customer paid, net of shipping refunds − carrier cost of outbound labels)
 * − payment-provider fees (PAYMENT_FEES)
 * − fit-guarantee expense (GUARANTEE_EXPENSE)
 * Shipping is a pass-through in the ledger (SHIPPING_PAYABLE), so its margin is computed here, not booked.
 */
export function contributionMargin(order: OrderForMargin, ledger: Record<string, number>) {
  const commissionHalalas = -(ledger.PLATFORM_COMMISSION ?? 0);
  const shippingRefunded = order.refunds
    .filter((r) => r.status === 'SUCCEEDED')
    .flatMap((r) => r.allocation as { shipping?: number }[])
    .reduce((s, a) => s + Math.max(0, a.shipping ?? 0), 0);
  const carrierCost = order.shipments.filter((s) => s.direction === 'OUTBOUND' && s.trackingNumber && s.status !== 'CANCELLED').reduce((s, x) => s + x.costHalalas, 0);
  const shippingMarginHalalas = order.shippingHalalas - shippingRefunded - carrierCost;
  const paymentFeesHalalas = ledger.PAYMENT_FEES ?? 0;
  const guaranteeExpenseHalalas = ledger.GUARANTEE_EXPENSE ?? 0;
  return {
    commissionHalalas,
    shippingMarginHalalas,
    paymentFeesHalalas,
    guaranteeExpenseHalalas,
    contributionHalalas: commissionHalalas + shippingMarginHalalas - paymentFeesHalalas - guaranteeExpenseHalalas,
  };
}

/** Ops finance: contribution margin per paid order (newest first) with totals. */
export async function orderMargins(q: { limit: number; offset: number; from?: Date; to?: Date }) {
  const where: Prisma.OrderWhereInput = { paidAt: { not: null, ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lt: q.to } : {}) } };
  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({ where, include: { payments: true, refunds: true, shipments: true }, orderBy: { paidAt: 'desc' }, take: q.limit, skip: q.offset }),
  ]);
  const ledger = await prisma.ledgerEntry.groupBy({ by: ['orderId', 'account'], where: { orderId: { in: orders.map((o) => o.id) } }, _sum: { amountHalalas: true } });
  const items = orders.map((o) => {
    const acct = Object.fromEntries(ledger.filter((l) => l.orderId === o.id).map((l) => [l.account, l._sum.amountHalalas ?? 0]));
    return {
      orderId: o.id,
      number: o.number,
      status: o.status,
      paidAt: o.paidAt,
      paymentMethod: o.paymentMethod,
      totalHalalas: o.totalHalalas,
      refundedHalalas: o.refundedHalalas,
      feesEstimated: o.payments.some((p) => p.feeEstimated),
      ...contributionMargin(o, acct),
    };
  });
  const sum = (k: 'commissionHalalas' | 'shippingMarginHalalas' | 'paymentFeesHalalas' | 'guaranteeExpenseHalalas' | 'contributionHalalas' | 'totalHalalas') => items.reduce((s, i) => s + i[k], 0);
  return {
    total,
    items,
    totals: {
      orders: items.length,
      gmvHalalas: sum('totalHalalas'),
      commissionHalalas: sum('commissionHalalas'),
      shippingMarginHalalas: sum('shippingMarginHalalas'),
      paymentFeesHalalas: sum('paymentFeesHalalas'),
      guaranteeExpenseHalalas: sum('guaranteeExpenseHalalas'),
      contributionHalalas: sum('contributionHalalas'),
      negativeOrders: items.filter((i) => i.contributionHalalas < 0).length,
    },
  };
}

/** Cross-checks one order across orders, payments, refunds and the ledger. Returns mismatches (empty = reconciled). */
export async function reconcileOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true, refunds: true, merchantOrders: true, items: true, shipments: true },
  });
  if (!order) throw notFound('Order');
  const issues: string[] = [];
  const captured = order.payments.reduce((s, p) => s + p.capturedHalalas, 0);
  const refundedPayments = order.payments.reduce((s, p) => s + p.refundedHalalas, 0);
  const refundsSucceeded = order.refunds.filter((r) => r.status === 'SUCCEEDED').reduce((s, r) => s + r.amountHalalas, 0);
  // Provider fees recorded at capture (one PAYMENT_FEE posting per captured payment).
  const fees = order.payments.filter((p) => p.capturedHalalas > 0).reduce((s, p) => s + p.feeHalalas, 0);
  const ledger = await prisma.ledgerEntry.groupBy({ by: ['account'], where: { orderId }, _sum: { amountHalalas: true } });
  const acct = (a: string) => ledger.find((l) => l.account === a)?._sum.amountHalalas ?? 0;
  const ledgerTotal = ledger.reduce((s, l) => s + (l._sum.amountHalalas ?? 0), 0);

  if (refundedPayments !== refundsSucceeded) issues.push(`payments.refunded ${refundedPayments} ≠ succeeded refunds ${refundsSucceeded}`);
  // NET_TERMS (credit) orders: the capture is owed by the workshop (receivable) until finance records repayments,
  // which move it to clearing. Refunds reduce the receivable first; only after repayment do they become cash owed back.
  // Card orders: CUSTOMER_CLEARING models the money held at the PSP; the PSP nets its fee from what it remits, so the
  // expected clearing balance is captured − refunded − provider fees (fees are platform cost, never refunded).
  const creditOrder = order.payments.some((p) => p.provider === CREDIT_PROVIDER);
  const receivable = acct('CUSTOMER_RECEIVABLE');
  const clearing = acct('CUSTOMER_CLEARING');
  let repaid = 0;
  if (creditOrder) {
    if (!order.buyerOrgId) issues.push('credit payment without a buying organisation');
    repaid = order.buyerOrgId ? await repaidForOrder(prisma, order.buyerOrgId, orderId) : 0;
    if (clearing + receivable !== captured - refundsSucceeded - fees) issues.push(`ledger receivable ${receivable} + clearing ${clearing} ≠ captured − refunded − fees ${captured - refundsSucceeded - fees}`);
    if (receivable < 0) issues.push(`receivable is negative (${receivable})`);
    if (clearing > repaid) issues.push(`clearing ${clearing} exceeds repayments allocated to this order ${repaid}`);
    if (clearing < repaid && receivable !== 0) issues.push('cash refunded to the workshop while a receivable is still open');
  } else {
    const expectedClearing = captured - refundsSucceeded - fees;
    if (clearing !== expectedClearing) issues.push(`ledger customer clearing ${clearing} ≠ captured − refunded − fees ${expectedClearing}`);
    if (receivable !== 0) issues.push(`receivable on a non-credit order (${receivable})`);
  }
  if (acct('PAYMENT_FEES') !== fees) issues.push(`ledger payment fees ${acct('PAYMENT_FEES')} ≠ recorded provider fees ${fees}`);
  if (ledgerTotal !== 0) issues.push(`ledger does not balance (${ledgerTotal})`);
  if (acct('SUSPENSE') !== 0) issues.push(`suspense not cleared (${acct('SUSPENSE')})`);
  if (acct('MERCHANT_RESERVE') > 0) issues.push(`merchant reserve released more than it held (${acct('MERCHANT_RESERVE')})`);
  const paidStatuses = ['PAID', 'IN_FULFILLMENT', 'PARTIALLY_SHIPPED', 'SHIPPED', 'PARTIALLY_DELIVERED', 'DELIVERED', 'COMPLETED'];
  if (paidStatuses.includes(order.status)) {
    const orderCaptured = order.payments.filter((p) => ['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(p.status)).length;
    if (orderCaptured !== 1) issues.push(`expected exactly one captured payment, found ${orderCaptured}`);
  }
  if (order.refundedHalalas !== order.refunds.filter((r) => r.status === 'SUCCEEDED' && (r.allocation as unknown[]).length > 0).reduce((s, r) => s + r.amountHalalas, 0)) {
    issues.push('order.refundedHalalas does not match succeeded order refunds');
  }
  // Fit guarantee cost: platform-funded outbound shipping refunds + Qitah-paid reverse labels, nothing else.
  const guaranteeRefunds = order.refunds
    .filter((r) => r.status === 'SUCCEEDED')
    .flatMap((r) => r.allocation as { platformShipping?: number }[])
    .reduce((s, a) => s + (a.platformShipping ?? 0), 0);
  const guaranteeLabels = order.shipments.filter((s) => s.direction === 'RETURN' && s.paidBy === 'PLATFORM' && s.trackingNumber).reduce((s, x) => s + x.costHalalas, 0);
  if (acct('GUARANTEE_EXPENSE') !== guaranteeRefunds + guaranteeLabels) {
    issues.push(`ledger guarantee expense ${acct('GUARANTEE_EXPENSE')} ≠ guarantee refunds + platform return labels ${guaranteeRefunds + guaranteeLabels}`);
  }
  const itemsSum = order.items.reduce((s, i) => s + i.lineTotalHalalas, 0);
  if (itemsSum !== order.itemsHalalas) issues.push(`items ${itemsSum} ≠ order.items ${order.itemsHalalas}`);
  const moItems = order.merchantOrders.reduce((s, m) => s + m.itemsHalalas, 0);
  const moShip = order.merchantOrders.reduce((s, m) => s + m.shippingHalalas, 0);
  if (moItems !== order.itemsHalalas || moShip !== order.shippingHalalas) issues.push('suborder totals do not add up to order totals');
  // Per-line commission: each suborder's commission is exactly the sum of its lines'.
  for (const mo of order.merchantOrders) {
    const lines = order.items.filter((i) => i.merchantOrderId === mo.id).reduce((s, i) => s + i.commissionHalalas, 0);
    if (lines !== mo.commissionHalalas) issues.push(`suborder ${mo.number} commission ${mo.commissionHalalas} ≠ Σ line commission ${lines}`);
  }
  const acctMap = Object.fromEntries(ledger.map((l) => [l.account, l._sum.amountHalalas ?? 0]));
  return {
    orderId,
    number: order.number,
    status: order.status,
    capturedHalalas: captured,
    refundedHalalas: refundsSucceeded,
    netCollectedHalalas: captured - refundsSucceeded,
    paymentFeesHalalas: fees,
    paymentFeesEstimated: order.payments.some((p) => p.feeEstimated),
    guaranteeExpenseHalalas: acct('GUARANTEE_EXPENSE'),
    creditOrder,
    receivableHalalas: receivable,
    repaidHalalas: repaid,
    margin: contributionMargin(order, acctMap),
    ledger: acctMap,
    reconciled: issues.length === 0,
    issues,
  };
}
