import type { Ctx } from '../context.js';
import { prisma, withTx } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import { audit, notify, type Actor } from './events.js';
import { post } from './ledger.js';
import { repaidForOrder } from './organizations.js';
import { CREDIT_PROVIDER } from './payments.js';

/**
 * Settlement eligibility: merchant order DELIVERED, return window elapsed, no open return case,
 * no pending refund, not yet settled. Amounts come from the ledger, never recomputed from prices.
 */
export async function eligibleMerchantOrders(ctx: Ctx, merchantId: string, asOf = new Date()) {
  const cutoff = new Date(asOf.getTime() - ctx.config.RETURN_WINDOW_DAYS * 86_400_000);
  const mos = await prisma.merchantOrder.findMany({
    where: {
      merchantId,
      status: 'DELIVERED',
      deliveredAt: { lte: cutoff },
      settlementLine: null,
      returnCases: { none: { status: { in: ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'] } } },
      order: { refunds: { none: { status: 'PENDING' } } },
    },
    orderBy: { deliveredAt: 'asc' },
  });
  if (!mos.length) return [];
  const sums = await prisma.ledgerEntry.groupBy({
    by: ['merchantOrderId', 'account'],
    where: { merchantOrderId: { in: mos.map((m) => m.id) }, account: { in: ['MERCHANT_PAYABLE', 'PLATFORM_COMMISSION'] } },
    _sum: { amountHalalas: true },
  });
  const get = (id: string, account: string) => -(sums.find((s) => s.merchantOrderId === id && s.account === account)?._sum.amountHalalas ?? 0);
  return mos.map((m) => {
    const net = get(m.id, 'MERCHANT_PAYABLE');
    const commission = get(m.id, 'PLATFORM_COMMISSION');
    return { merchantOrder: m, grossHalalas: m.itemsHalalas, commissionHalalas: commission, netHalalas: net, refundsHalalas: m.itemsHalalas - commission - net };
  });
}

export async function generateSettlement(ctx: Ctx, actor: Actor, merchantId: string, asOf?: Date) {
  const lines = await eligibleMerchantOrders(ctx, merchantId, asOf);
  if (!lines.length) throw conflict('NOTHING_TO_SETTLE', 'No merchant orders are eligible for settlement yet');
  return withTx(async (tx) => {
    const s = await tx.settlement.create({
      data: {
        merchantId,
        grossHalalas: lines.reduce((a, l) => a + l.grossHalalas, 0),
        commissionHalalas: lines.reduce((a, l) => a + l.commissionHalalas, 0),
        refundsHalalas: lines.reduce((a, l) => a + l.refundsHalalas, 0),
        netHalalas: lines.reduce((a, l) => a + l.netHalalas, 0),
        lines: {
          create: lines.map((l) => ({
            merchantOrderId: l.merchantOrder.id,
            grossHalalas: l.grossHalalas,
            commissionHalalas: l.commissionHalalas,
            refundsHalalas: l.refundsHalalas,
            netHalalas: l.netHalalas,
          })),
        },
      },
      include: { lines: true },
    });
    await audit(tx, actor, { action: 'settlement.generated', entityType: 'settlement', entityId: s.id, merchantId, data: { net: s.netHalalas } });
    return s;
  });
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
    /** Owed to merchant and not yet paid out (credit balance shown positive). */
    payableHalalas: -val('MERCHANT_PAYABLE'),
    commissionHalalas: -val('PLATFORM_COMMISSION'),
    paidOutHalalas: -val('PAYOUTS'),
  };
}

/** Cross-checks one order across orders, payments, refunds and the ledger. Returns mismatches (empty = reconciled). */
export async function reconcileOrder(orderId: string) {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: { payments: true, refunds: true, merchantOrders: true, items: true, shipments: { where: { direction: 'RETURN' } } },
  });
  if (!order) throw notFound('Order');
  const issues: string[] = [];
  const captured = order.payments.reduce((s, p) => s + p.capturedHalalas, 0);
  const refundedPayments = order.payments.reduce((s, p) => s + p.refundedHalalas, 0);
  const refundsSucceeded = order.refunds.filter((r) => r.status === 'SUCCEEDED').reduce((s, r) => s + r.amountHalalas, 0);
  const ledger = await prisma.ledgerEntry.groupBy({ by: ['account'], where: { orderId }, _sum: { amountHalalas: true } });
  const acct = (a: string) => ledger.find((l) => l.account === a)?._sum.amountHalalas ?? 0;
  const ledgerTotal = ledger.reduce((s, l) => s + (l._sum.amountHalalas ?? 0), 0);

  if (refundedPayments !== refundsSucceeded) issues.push(`payments.refunded ${refundedPayments} ≠ succeeded refunds ${refundsSucceeded}`);
  // NET_TERMS (credit) orders: the capture is owed by the workshop (receivable) until finance records repayments,
  // which move it to clearing. Refunds reduce the receivable first; only after repayment do they become cash owed back.
  const creditOrder = order.payments.some((p) => p.provider === CREDIT_PROVIDER);
  const receivable = acct('CUSTOMER_RECEIVABLE');
  const clearing = acct('CUSTOMER_CLEARING');
  let repaid = 0;
  if (creditOrder) {
    if (!order.buyerOrgId) issues.push('credit payment without a buying organisation');
    repaid = order.buyerOrgId ? await repaidForOrder(prisma, order.buyerOrgId, orderId) : 0;
    if (clearing + receivable !== captured - refundsSucceeded) issues.push(`ledger receivable ${receivable} + clearing ${clearing} ≠ captured − refunded ${captured - refundsSucceeded}`);
    if (receivable < 0) issues.push(`receivable is negative (${receivable})`);
    if (clearing > repaid) issues.push(`clearing ${clearing} exceeds repayments allocated to this order ${repaid}`);
    if (clearing < repaid && receivable !== 0) issues.push('cash refunded to the workshop while a receivable is still open');
  } else {
    if (clearing !== captured - refundsSucceeded) issues.push(`ledger customer clearing ${clearing} ≠ captured − refunded ${captured - refundsSucceeded}`);
    if (receivable !== 0) issues.push(`receivable on a non-credit order (${receivable})`);
  }
  if (ledgerTotal !== 0) issues.push(`ledger does not balance (${ledgerTotal})`);
  if (acct('SUSPENSE') !== 0) issues.push(`suspense not cleared (${acct('SUSPENSE')})`);
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
  const guaranteeLabels = order.shipments.filter((s) => s.paidBy === 'PLATFORM' && s.trackingNumber).reduce((s, x) => s + x.costHalalas, 0);
  if (acct('GUARANTEE_EXPENSE') !== guaranteeRefunds + guaranteeLabels) {
    issues.push(`ledger guarantee expense ${acct('GUARANTEE_EXPENSE')} ≠ guarantee refunds + platform return labels ${guaranteeRefunds + guaranteeLabels}`);
  }
  const itemsSum = order.items.reduce((s, i) => s + i.lineTotalHalalas, 0);
  if (itemsSum !== order.itemsHalalas) issues.push(`items ${itemsSum} ≠ order.items ${order.itemsHalalas}`);
  const moItems = order.merchantOrders.reduce((s, m) => s + m.itemsHalalas, 0);
  const moShip = order.merchantOrders.reduce((s, m) => s + m.shippingHalalas, 0);
  if (moItems !== order.itemsHalalas || moShip !== order.shippingHalalas) issues.push('suborder totals do not add up to order totals');
  return {
    orderId,
    number: order.number,
    status: order.status,
    capturedHalalas: captured,
    refundedHalalas: refundsSucceeded,
    netCollectedHalalas: captured - refundsSucceeded,
    guaranteeExpenseHalalas: acct('GUARANTEE_EXPENSE'),
    creditOrder,
    receivableHalalas: receivable,
    repaidHalalas: repaid,
    ledger: Object.fromEntries(ledger.map((l) => [l.account, l._sum.amountHalalas ?? 0])),
    reconciled: issues.length === 0,
    issues,
  };
}
