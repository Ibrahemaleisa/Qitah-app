import { Prisma, type LedgerAccount, type MerchantOrder, type Order, type Payment } from '@prisma/client';

import type { Ctx } from '../context.js';
import { prisma, withTx, type Tx } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import type { PaymentWebhookEvent } from '../providers/payment/types.js';
import { audit, emit, notify, type Actor } from './events.js';
import { commitOrder, releaseOrder } from './inventory.js';
import { post, type LedgerLine } from './ledger.js';

/**
 * Payment lifecycle. An order becomes PAID only from a verified provider webhook — never from a
 * client-side success callback. Webhooks are deduplicated on (provider, providerEventId).
 *
 * Exception: NET_TERMS orders of approved workshops are captured by the server at checkout against Qitah's
 * internal credit line (Payment.provider = CREDIT_PROVIDER). No money moves through a provider for them;
 * the workshop owes Qitah (CUSTOMER_RECEIVABLE) until finance records its repayment.
 */

/** Payment.provider for NET_TERMS orders. Never sent to the payment provider (no providerPaymentId). */
export const CREDIT_PROVIDER = 'credit';

export async function initiatePayment(ctx: Ctx, orderId: string, method: string): Promise<Payment> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { payments: { orderBy: { createdAt: 'desc' } } } });
  if (order.status !== 'PENDING_PAYMENT') throw conflict('ORDER_NOT_PAYABLE', `Order is ${order.status}`);
  if (order.paymentExpiresAt < new Date()) throw conflict('PAYMENT_WINDOW_EXPIRED', 'Payment window expired');
  const reusable = order.payments.find((p) => p.status === 'INITIATED' && p.method === method && p.redirectUrl);
  if (reusable) return reusable;

  const payment = await prisma.payment.create({
    data: { orderId, provider: ctx.payments.code, method, amountHalalas: order.totalHalalas, sandbox: ctx.payments.sandbox },
  });
  try {
    const created = await ctx.payments.createPayment({
      paymentId: payment.id,
      amountHalalas: order.totalHalalas,
      method,
      description: `Qitah order ${order.number}`,
      returnUrl: `qitah://checkout/return?order=${order.id}`,
    });
    return await prisma.payment.update({ where: { id: payment.id }, data: { providerPaymentId: created.providerPaymentId, redirectUrl: created.redirectUrl } });
  } catch (e) {
    await prisma.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: 'PROVIDER_UNAVAILABLE' } });
    throw conflict('PAYMENT_PROVIDER_UNAVAILABLE', 'Payment provider unavailable, please retry', { cause: String(e) });
  }
}

export type WebhookResult = { outcome: 'processed' | 'duplicate' | 'ignored' | 'flagged'; detail?: string };

export async function handlePaymentWebhook(ctx: Ctx, event: PaymentWebhookEvent): Promise<WebhookResult> {
  try {
    return await withTx(async (tx) => {
      // Insert-first dedupe: a replayed event hits the unique constraint and is acknowledged untouched.
      const record = await tx.paymentEvent.create({
        data: { provider: ctx.payments.code, providerEventId: event.id, type: event.type, payload: event as unknown as Prisma.InputJsonValue, outcome: 'pending' },
      });
      const result = await applyEvent(ctx, tx, event);
      await tx.paymentEvent.update({ where: { id: record.id }, data: { outcome: result.outcome + (result.detail ? `:${result.detail}` : ''), paymentId: result.paymentId } });
      return { outcome: result.outcome, detail: result.detail };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return { outcome: 'duplicate' };
    throw e;
  }
}

/**
 * Locks Order then Payment — the same order used by expiry and cancellation — so a capture can never
 * interleave with an expiry that releases the stock (which would leave a PAID order with no stock held).
 */
async function lockPayment(tx: Tx, providerPaymentId: string) {
  const found = await tx.payment.findFirst({ where: { providerPaymentId }, select: { orderId: true } });
  if (!found) return null;
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${found.orderId} FOR UPDATE`;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Payment" WHERE "providerPaymentId" = ${providerPaymentId} FOR UPDATE`;
  if (!rows.length) return null;
  return tx.payment.findUniqueOrThrow({ where: { id: rows[0].id }, include: { order: { include: { merchantOrders: true } } } });
}

async function applyEvent(ctx: Ctx, tx: Tx, event: PaymentWebhookEvent): Promise<WebhookResult & { paymentId?: string }> {
  const payment = await lockPayment(tx, event.providerPaymentId);
  if (!payment) return { outcome: 'flagged', detail: 'UNKNOWN_PAYMENT' };
  const order = payment.order;
  const actor: Actor = { type: 'payment_provider' };

  if (event.type === 'payment.captured') {
    // Already captured → nothing to do. CANCELLED/FAILED payments that the provider nevertheless captured
    // must still be recorded (money moved), so they fall through to the late-payment path below.
    if (['CAPTURED', 'PARTIALLY_REFUNDED', 'REFUNDED'].includes(payment.status)) return { outcome: 'ignored', detail: `PAYMENT_${payment.status}`, paymentId: payment.id };
    if (event.amountHalalas !== payment.amountHalalas) {
      await notify(tx, { audience: 'OPS', type: 'payment.mismatch', title: 'مبلغ دفع غير مطابق', body: `الطلب ${order.number}`, data: { orderId: order.id } });
      return { outcome: 'flagged', detail: 'AMOUNT_MISMATCH', paymentId: payment.id };
    }
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'CAPTURED', capturedHalalas: event.amountHalalas } });

    if (order.status !== 'PENDING_PAYMENT') {
      // Money arrived for an order we can no longer fulfil (expired / cancelled / paid twice): hold in suspense and refund in full.
      await post(tx, {
        type: 'PAYMENT_CAPTURED_UNFULFILLABLE',
        refType: 'payment',
        refId: payment.id,
        orderId: order.id,
        lines: [
          { account: 'CUSTOMER_CLEARING', amountHalalas: event.amountHalalas },
          { account: 'SUSPENSE', amountHalalas: -event.amountHalalas },
        ],
      });
      await createRefund(tx, {
        payment: { ...payment, status: 'CAPTURED', capturedHalalas: event.amountHalalas },
        amountHalalas: event.amountHalalas,
        reason: 'LATE_OR_DUPLICATE_PAYMENT',
        allocation: [],
        idempotencyKey: `auto-late:${payment.id}`,
        actor,
      });
      await notify(tx, { audience: 'OPS', type: 'payment.late', title: 'دفع متأخر — استرداد تلقائي', body: `الطلب ${order.number}`, data: { orderId: order.id } });
      return { outcome: 'flagged', detail: 'LATE_PAYMENT_REFUNDED', paymentId: payment.id };
    }

    await confirmPaidOrder(tx, { order, paymentId: payment.id, amountHalalas: event.amountHalalas, debit: 'CUSTOMER_CLEARING', actor });
    return { outcome: 'processed', paymentId: payment.id };
  }

  if (event.type === 'payment.failed') {
    if (payment.status !== 'INITIATED') return { outcome: 'ignored', detail: `PAYMENT_${payment.status}`, paymentId: payment.id };
    await tx.payment.update({ where: { id: payment.id }, data: { status: 'FAILED', failureReason: event.failureReason ?? 'DECLINED' } });
    // The order stays PENDING_PAYMENT until its reservation window ends, so the customer can retry.
    await emit(tx, { type: 'payment.failed', entityType: 'order', entityId: order.id, orderId: order.id, customerId: order.customerId });
    return { outcome: 'processed', paymentId: payment.id };
  }

  // Refund events
  const refund = event.providerRefundId
    ? await tx.refund.findFirst({ where: { providerRefundId: event.providerRefundId, paymentId: payment.id } })
    : null;
  if (!refund) return { outcome: 'flagged', detail: 'UNKNOWN_REFUND', paymentId: payment.id };
  if (refund.status !== 'PENDING') return { outcome: 'ignored', detail: `REFUND_${refund.status}`, paymentId: payment.id };
  if (event.type === 'refund.failed') {
    await tx.refund.update({ where: { id: refund.id }, data: { status: 'FAILED', failureReason: event.failureReason ?? 'FAILED' } });
    await notify(tx, { audience: 'OPS', type: 'refund.failed', title: 'فشل الاسترداد', body: `الطلب ${order.number}`, data: { orderId: order.id, refundId: refund.id } });
    return { outcome: 'processed', paymentId: payment.id };
  }
  if (event.amountHalalas !== refund.amountHalalas) return { outcome: 'flagged', detail: 'REFUND_AMOUNT_MISMATCH', paymentId: payment.id };
  await settleRefund(tx, refund.id);
  return { outcome: 'processed', paymentId: payment.id };
}

/**
 * Marks a PENDING_PAYMENT order PAID once its money is secured, commits stock, releases suborders to merchants
 * and posts the capture. The caller holds the Order lock. `debit` is CUSTOMER_CLEARING for money received from a
 * payment provider (verified webhook), or CUSTOMER_RECEIVABLE for a NET_TERMS order the workshop owes Qitah.
 * Either way the merchant payable is identical: merchants are paid by Qitah regardless of how the buyer pays.
 */
export async function confirmPaidOrder(
  tx: Tx,
  input: {
    order: Order & { merchantOrders: MerchantOrder[] };
    paymentId: string;
    amountHalalas: number;
    debit: Extract<LedgerAccount, 'CUSTOMER_CLEARING' | 'CUSTOMER_RECEIVABLE'>;
    actor: Actor;
    now?: Date;
    orderData?: Prisma.OrderUpdateInput;
  },
) {
  const { order, actor } = input;
  const now = input.now ?? new Date();
  await commitOrder(tx, order.id);
  await tx.order.update({ where: { id: order.id }, data: { ...input.orderData, status: 'PAID', paidAt: now } });
  const merchants = await tx.merchant.findMany({ where: { id: { in: order.merchantOrders.map((m) => m.merchantId) } } });
  for (const mo of order.merchantOrders) {
    const m = merchants.find((x) => x.id === mo.merchantId)!;
    await tx.merchantOrder.update({ where: { id: mo.id }, data: { status: 'NEW', acceptBy: new Date(now.getTime() + m.slaAcceptMinutes * 60_000) } });
    await notify(tx, { audience: 'MERCHANT', merchantId: mo.merchantId, type: 'merchant_order.new', title: 'طلب جديد', body: `طلب ${mo.number} بانتظار القبول`, data: { merchantOrderId: mo.id } });
  }
  const lines: LedgerLine[] = [{ account: input.debit, amountHalalas: order.totalHalalas }];
  for (const mo of order.merchantOrders) {
    lines.push({ account: 'MERCHANT_PAYABLE', amountHalalas: -(mo.itemsHalalas - mo.commissionHalalas), merchantId: mo.merchantId, merchantOrderId: mo.id });
    lines.push({ account: 'PLATFORM_COMMISSION', amountHalalas: -mo.commissionHalalas, merchantId: mo.merchantId, merchantOrderId: mo.id });
    lines.push({ account: 'SHIPPING_PAYABLE', amountHalalas: -mo.shippingHalalas, merchantId: mo.merchantId, merchantOrderId: mo.id });
  }
  if (order.discountHalalas) lines.push({ account: 'PLATFORM_COMMISSION', amountHalalas: order.discountHalalas });
  await post(tx, { type: 'PAYMENT_CAPTURED', refType: 'payment', refId: input.paymentId, orderId: order.id, lines });
  await audit(tx, actor, { action: 'payment.captured', entityType: 'order', entityId: order.id, data: { paymentId: input.paymentId, amount: input.amountHalalas, debit: input.debit } });
  await emit(tx, {
    type: 'order.paid',
    entityType: 'order',
    entityId: order.id,
    orderId: order.id,
    customerId: order.customerId,
    merchantIds: order.merchantOrders.map((m) => m.merchantId),
  });
  const body = input.debit === 'CUSTOMER_RECEIVABLE' ? 'تم تأكيد الطلب على حساب الدفع الآجل' : 'تم تأكيد الدفع';
  await notify(tx, { audience: 'CUSTOMER', userId: order.customerId, type: 'order.paid', title: `الطلب ${order.number}`, body, data: { orderId: order.id } });
}

/**
 * Per-merchant refund split used for ledger postings. `shipping` reverses (or, negative, adds to) the carrier
 * payable; `platformShipping` is the part Qitah funds itself (fit guarantee), booked to GUARANTEE_EXPENSE.
 */
export type Allocation = { merchantId: string; merchantOrderId: string; items: number; commission: number; shipping: number; platformShipping?: number }[];

/** Creates a PENDING refund (DB only). Call `submitPendingRefunds` after the transaction commits. */
export async function createRefund(
  tx: Tx,
  input: {
    payment: Pick<Payment, 'id' | 'orderId' | 'status' | 'capturedHalalas' | 'refundedHalalas'>;
    amountHalalas: number;
    reason: string;
    allocation: Allocation;
    idempotencyKey: string;
    returnCaseId?: string;
    actor: Actor;
  },
) {
  // Serialise refunds per payment so parallel requests cannot both pass the "refundable" check.
  await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${input.payment.id} FOR UPDATE`;
  const existing = await tx.refund.findUnique({ where: { idempotencyKey: input.idempotencyKey } });
  if (existing) return existing;
  if (!Number.isSafeInteger(input.amountHalalas) || input.amountHalalas <= 0) throw badRequest('INVALID_AMOUNT', 'Refund amount must be positive');
  const current = await tx.payment.findUniqueOrThrow({ where: { id: input.payment.id } });
  if (!['CAPTURED', 'PARTIALLY_REFUNDED'].includes(current.status)) throw conflict('NOT_REFUNDABLE', 'Payment is not captured');
  const pending = await tx.refund.aggregate({ where: { paymentId: current.id, status: 'PENDING' }, _sum: { amountHalalas: true } });
  const refundable = current.capturedHalalas - current.refundedHalalas - (pending._sum.amountHalalas ?? 0);
  if (input.amountHalalas > refundable) throw conflict('REFUND_EXCEEDS_CAPTURED', `At most ${refundable} halalas can be refunded`, { refundable });
  const allocated = input.allocation.reduce((s, a) => s + a.items + a.shipping + (a.platformShipping ?? 0), 0);
  if (input.allocation.length && allocated !== input.amountHalalas) throw new Error('Refund allocation does not sum to amount');
  const refund = await tx.refund.create({
    data: {
      paymentId: input.payment.id,
      orderId: input.payment.orderId,
      returnCaseId: input.returnCaseId,
      amountHalalas: input.amountHalalas,
      reason: input.reason,
      allocation: input.allocation,
      idempotencyKey: input.idempotencyKey,
      createdById: input.actor.userId,
    },
  });
  await audit(tx, input.actor, { action: 'refund.requested', entityType: 'order', entityId: input.payment.orderId, data: { refundId: refund.id, amount: input.amountHalalas, reason: input.reason } });
  await emit(tx, { type: 'refund.requested', entityType: 'refund', entityId: refund.id, orderId: input.payment.orderId });
  // NET_TERMS: nothing to send to a provider. The refund reduces what the workshop owes, in this transaction.
  if (current.provider === CREDIT_PROVIDER) return settleRefund(tx, refund.id);
  return refund;
}

/** Sends PENDING refunds without a provider id to the provider. Safe to call repeatedly (worker + inline). */
export async function submitPendingRefunds(ctx: Ctx, orderId?: string) {
  const pending = await prisma.refund.findMany({
    where: { status: 'PENDING', providerRefundId: null, ...(orderId ? { orderId } : {}) },
    include: { payment: true },
    take: 50,
  });
  for (const r of pending) {
    if (!r.payment.providerPaymentId) continue;
    const res = await ctx.payments.refund({ providerPaymentId: r.payment.providerPaymentId, amountHalalas: r.amountHalalas, idempotencyKey: r.idempotencyKey });
    await prisma.refund.updateMany({ where: { id: r.id, providerRefundId: null }, data: { providerRefundId: res.providerRefundId } });
  }
  return pending.length;
}

async function settleRefund(tx: Tx, refundId: string) {
  const pending = await tx.refund.findUniqueOrThrow({ where: { id: refundId }, include: { payment: true } });
  const credit = pending.payment.provider === CREDIT_PROVIDER;
  const refund = await tx.refund.update({ where: { id: refundId }, data: { status: 'SUCCEEDED', ...(credit ? { providerRefundId: `credit:${refundId}` } : {}) } });
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: refund.paymentId } });
  const refunded = payment.refundedHalalas + refund.amountHalalas;
  await tx.payment.update({
    where: { id: payment.id },
    data: { refundedHalalas: refunded, status: refunded >= payment.capturedHalalas ? 'REFUNDED' : 'PARTIALLY_REFUNDED' },
  });
  const order = await tx.order.findUniqueOrThrow({ where: { id: refund.orderId } });
  // Late/duplicate payments are refunded from suspense and never counted against the order total.
  const fromSuspense = (refund.allocation as Allocation).length === 0;
  if (!fromSuspense) {
    await tx.order.update({ where: { id: order.id }, data: { refundedHalalas: { increment: refund.amountHalalas } } });
  }
  const lines: LedgerLine[] = [];
  if (credit) {
    // Credit order: reduce the receivable. Only if the workshop already repaid this order does the remainder
    // become cash Qitah owes back to it (CUSTOMER_CLEARING, paid out by finance like a provider refund).
    const owed = await tx.ledgerEntry.aggregate({ where: { orderId: order.id, account: 'CUSTOMER_RECEIVABLE' }, _sum: { amountHalalas: true } });
    const fromReceivable = Math.min(refund.amountHalalas, Math.max(0, owed._sum.amountHalalas ?? 0));
    lines.push({ account: 'CUSTOMER_RECEIVABLE', amountHalalas: -fromReceivable });
    if (refund.amountHalalas > fromReceivable) {
      lines.push({ account: 'CUSTOMER_CLEARING', amountHalalas: -(refund.amountHalalas - fromReceivable) });
      await notify(tx, {
        audience: 'OPS',
        type: 'credit.refund_payout',
        title: 'استرداد نقدي لورشة',
        body: `الطلب ${order.number}: ${((refund.amountHalalas - fromReceivable) / 100).toFixed(2)} ر.س بعد السداد`,
        data: { orderId: order.id, refundId: refund.id },
      });
    }
  } else {
    lines.push({ account: 'CUSTOMER_CLEARING', amountHalalas: -refund.amountHalalas });
  }
  if (fromSuspense) lines.push({ account: 'SUSPENSE', amountHalalas: refund.amountHalalas });
  for (const a of refund.allocation as Allocation) {
    lines.push({ account: 'MERCHANT_PAYABLE', amountHalalas: a.items - a.commission, merchantId: a.merchantId, merchantOrderId: a.merchantOrderId });
    lines.push({ account: 'PLATFORM_COMMISSION', amountHalalas: a.commission, merchantId: a.merchantId, merchantOrderId: a.merchantOrderId });
    lines.push({ account: 'SHIPPING_PAYABLE', amountHalalas: a.shipping, merchantId: a.merchantId, merchantOrderId: a.merchantOrderId });
    if (a.platformShipping) lines.push({ account: 'GUARANTEE_EXPENSE', amountHalalas: a.platformShipping, merchantId: a.merchantId, merchantOrderId: a.merchantOrderId });
  }
  await post(tx, { type: 'REFUND_SUCCEEDED', refType: 'refund', refId: refund.id, orderId: order.id, lines });
  if (refund.returnCaseId) {
    const rc = await tx.returnCase.findUniqueOrThrow({ where: { id: refund.returnCaseId } });
    if (rc.status === 'RECEIVED') await tx.returnCase.update({ where: { id: rc.id }, data: { status: 'REFUNDED' } });
  }
  await emit(tx, { type: 'refund.succeeded', entityType: 'refund', entityId: refund.id, orderId: order.id, customerId: order.customerId });
  await notify(tx, {
    audience: 'CUSTOMER',
    userId: order.customerId,
    type: 'refund.succeeded',
    title: `الطلب ${order.number}`,
    body: credit
      ? `تم خصم ${(refund.amountHalalas / 100).toFixed(2)} ر.س من مستحقات الدفع الآجل`
      : `تم استرداد ${(refund.amountHalalas / 100).toFixed(2)} ر.س`,
    data: { orderId: order.id },
  });
  return refund;
}

/** Expires unpaid orders whose reservation window ended and releases their stock. */
export async function expireUnpaidOrders(now = new Date()) {
  const due = await prisma.order.findMany({ where: { status: 'PENDING_PAYMENT', paymentExpiresAt: { lt: now } }, select: { id: true }, take: 100 });
  let expired = 0;
  for (const { id } of due) {
    await withTx(async (tx) => {
      const locked = await tx.$queryRaw<{ status: string }[]>`SELECT status FROM "Order" WHERE id = ${id} FOR UPDATE`;
      if (locked[0]?.status !== 'PENDING_PAYMENT') return;
      await releaseOrder(tx, id);
      await tx.order.update({ where: { id }, data: { status: 'EXPIRED' } });
      await tx.merchantOrder.updateMany({ where: { orderId: id }, data: { status: 'CANCELLED' } });
      await tx.payment.updateMany({ where: { orderId: id, status: 'INITIATED' }, data: { status: 'CANCELLED' } });
      await emit(tx, { type: 'order.expired', entityType: 'order', entityId: id, orderId: id });
      expired++;
    });
  }
  return expired;
}

export async function getOrderPaymentState(orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { payments: true } });
  if (!order) throw notFound('Order');
  return order;
}
