import type { MerchantOrderStatus } from '@prisma/client';

import type { Ctx } from '../context.js';
import { prisma, withTx, type Tx } from '../db.js';
import { assertTransition, COLLECTED, MERCHANT_ORDER_TRANSITIONS } from '../domain/states.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { audit, emit, notify, type Actor } from './events.js';
import { releaseOrder, restock } from './inventory.js';
import { refreshListingsForOffers } from './listings.js';
import { recomputeOrderStatus } from './orders.js';
import { createRefund, submitPendingRefunds, type Allocation } from './payments.js';
import { ensureOutboundShipments } from './shipping.js';

async function lockMerchantOrder(tx: Tx, id: string, merchantId?: string) {
  const rows = await tx.$queryRaw<{ id: string; merchantId: string }[]>`SELECT id, "merchantId" FROM "MerchantOrder" WHERE id = ${id} FOR UPDATE`;
  // Merchant-scoped callers get 404 for other merchants' orders: no existence leak.
  if (!rows.length || (merchantId && rows[0].merchantId !== merchantId)) throw notFound('Merchant order');
  return tx.merchantOrder.findUniqueOrThrow({ where: { id }, include: { merchant: true, order: true, items: true } });
}

async function transition(
  _ctx: Ctx,
  actor: Actor,
  id: string,
  merchantId: string | undefined,
  to: MerchantOrderStatus,
  extra: (mo: Awaited<ReturnType<typeof lockMerchantOrder>>, tx: Tx) => Promise<Record<string, unknown>> = async () => ({}),
) {
  return withTx(async (tx) => {
    const mo = await lockMerchantOrder(tx, id, merchantId);
    assertTransition(MERCHANT_ORDER_TRANSITIONS, mo.status, to, 'Merchant order');
    const data = await extra(mo, tx);
    await tx.merchantOrder.update({ where: { id }, data: { status: to, ...data } });
    await audit(tx, actor, { action: `merchant_order.${to.toLowerCase()}`, entityType: 'merchant_order', entityId: id, merchantId: mo.merchantId, data: { from: mo.status } });
    await emit(tx, { type: 'merchant_order.updated', entityType: 'merchant_order', entityId: id, orderId: mo.orderId, customerId: mo.order.customerId, merchantIds: [mo.merchantId], payload: { from: mo.status, to } });
    await recomputeOrderStatus(tx, mo.orderId);
    return tx.merchantOrder.findUniqueOrThrow({ where: { id } });
  });
}

export const acceptMerchantOrder = (ctx: Ctx, actor: Actor, id: string, merchantId?: string) =>
  transition(ctx, actor, id, merchantId, 'ACCEPTED', async (mo, tx) => {
    // Accepting is an availability confirmation for the offers on this order (offer freshness).
    await tx.offer.updateMany({ where: { id: { in: mo.items.map((i) => i.offerId) }, visibility: 'PUBLIC' }, data: { lastConfirmedAt: new Date() } });
    await refreshListingsForOffers(tx, mo.items.map((i) => i.offerId));
    return { acceptedAt: new Date(), readyBy: new Date(Date.now() + mo.merchant.slaReadyMinutes * 60_000) };
  });

export const startPacking = (ctx: Ctx, actor: Actor, id: string, merchantId?: string) => transition(ctx, actor, id, merchantId, 'PACKING');

export const markReady = (ctx: Ctx, actor: Actor, id: string, merchantId?: string) =>
  transition(ctx, actor, id, merchantId, 'READY_FOR_PICKUP', async (mo, tx) => {
    const created = await ensureOutboundShipments(tx, mo.id);
    await notify(tx, { audience: 'OPS', type: 'merchant_order.ready', title: 'جاهز للشحن', body: `${mo.number} — ${created.length} شحنة بانتظار البوليصة`, data: { merchantOrderId: mo.id } });
    return { readyAt: new Date() };
  });

/** Merchant (or ops) rejects: stock goes back, the customer is refunded this merchant's share incl. its shipping. */
export async function rejectMerchantOrder(ctx: Ctx, actor: Actor, id: string, reason: string, merchantId?: string) {
  const result = await withTx(async (tx) => {
    const mo = await lockMerchantOrder(tx, id, merchantId);
    assertTransition(MERCHANT_ORDER_TRANSITIONS, mo.status, 'REJECTED', 'Merchant order');
    await cancelMerchantOrderInTx(tx, mo, actor, 'REJECTED', reason);
    await notify(tx, {
      audience: 'CUSTOMER',
      userId: mo.order.customerId,
      type: 'merchant_order.rejected',
      title: `الطلب ${mo.order.number}`,
      body: 'تعذر على أحد التجار تنفيذ جزء من طلبك وسيتم استرداد مبلغه',
      data: { orderId: mo.orderId },
    });
    await notify(tx, { audience: 'OPS', type: 'merchant_order.rejected', title: 'رفض تاجر', body: `${mo.number}: ${reason}`, data: { merchantOrderId: mo.id } });
    return mo.orderId;
  });
  await submitPendingRefunds(ctx, result);
  await cancelCarrierLabels(ctx, { merchantOrderId: id });
  return prisma.merchantOrder.findUniqueOrThrow({ where: { id } });
}

async function cancelMerchantOrderInTx(
  tx: Tx,
  mo: Awaited<ReturnType<typeof lockMerchantOrder>>,
  actor: Actor,
  to: 'REJECTED' | 'CANCELLED',
  reason: string,
) {
  const shipments = await tx.shipment.findMany({ where: { merchantOrderId: mo.id, direction: 'OUTBOUND', status: { not: 'CANCELLED' } } });
  if (shipments.some((s) => COLLECTED.includes(s.status))) throw conflict('ALREADY_SHIPPED', 'A shipment was already collected by the carrier');
  for (const s of shipments) {
    await tx.shipment.update({ where: { id: s.id }, data: { status: 'CANCELLED' } });
    await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: 'CANCELLED', description: `Cancelled: ${reason}`, source: 'SYSTEM', occurredAt: new Date() } });
  }
  for (const item of mo.items.filter((i) => i.status === 'ACTIVE')) {
    await restock(tx, { offerId: item.offerId, quantity: item.quantity, reason: 'CANCELLATION_RESTOCK', refType: 'merchant_order', refId: mo.id, actor });
    await tx.orderItem.update({ where: { id: item.id }, data: { status: 'CANCELLED' } });
  }
  await tx.merchantOrder.update({ where: { id: mo.id }, data: { status: to, rejectedReason: reason } });
  const payment = await tx.payment.findFirst({ where: { orderId: mo.orderId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } });
  if (payment) {
    const allocation: Allocation = [
      {
        merchantId: mo.merchantId,
        merchantOrderId: mo.id,
        items: mo.itemsHalalas,
        commission: mo.commissionHalalas,
        shipping: mo.shippingHalalas,
        lines: mo.items.map((i) => ({ orderItemId: i.id, items: i.lineTotalHalalas, commission: i.commissionHalalas })),
      },
    ];
    await createRefund(tx, {
      payment,
      amountHalalas: mo.itemsHalalas + mo.shippingHalalas,
      reason: `${to}:${reason}`,
      allocation,
      idempotencyKey: `mo-cancel:${mo.id}`,
      actor,
    });
  }
  await audit(tx, actor, { action: `merchant_order.${to.toLowerCase()}`, entityType: 'merchant_order', entityId: mo.id, merchantId: mo.merchantId, data: { reason } });
  await emit(tx, { type: 'merchant_order.updated', entityType: 'merchant_order', entityId: mo.id, orderId: mo.orderId, customerId: mo.order.customerId, merchantIds: [mo.merchantId], payload: { to } });
  await recomputeOrderStatus(tx, mo.orderId);
}

/** Customer cancellation: unpaid → release holds; paid → allowed until any shipment is collected. */
export async function cancelOrderByCustomer(ctx: Ctx, userId: string, orderId: string, reason: string) {
  const actor: Actor = { userId, type: 'customer' };
  await withTx(async (tx) => {
    const rows = await tx.$queryRaw<{ customerId: string }[]>`SELECT "customerId" FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
    if (!rows.length || rows[0].customerId !== userId) throw notFound('Order');
    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status === 'PENDING_PAYMENT') {
      await releaseOrder(tx, orderId);
      await tx.order.update({ where: { id: orderId }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason } });
      await tx.merchantOrder.updateMany({ where: { orderId }, data: { status: 'CANCELLED' } });
      await tx.payment.updateMany({ where: { orderId, status: 'INITIATED' }, data: { status: 'CANCELLED' } });
    } else if (['PAID', 'IN_FULFILLMENT'].includes(order.status)) {
      const mos = await tx.merchantOrder.findMany({ where: { orderId, status: { notIn: ['REJECTED', 'CANCELLED'] } } });
      if (mos.some((m) => !['NEW', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'].includes(m.status))) throw conflict('NOT_CANCELLABLE', 'Part of this order has already shipped');
      await tx.order.update({ where: { id: orderId }, data: { cancelReason: reason } });
      for (const m of mos) {
        const locked = await lockMerchantOrder(tx, m.id);
        await cancelMerchantOrderInTx(tx, locked, actor, 'CANCELLED', reason);
        await notify(tx, { audience: 'MERCHANT', merchantId: m.merchantId, type: 'merchant_order.cancelled', title: 'إلغاء طلب', body: `ألغى العميل الطلب ${m.number}`, data: { merchantOrderId: m.id } });
      }
    } else {
      throw conflict('NOT_CANCELLABLE', `Order is ${order.status}`);
    }
    await audit(tx, actor, { action: 'order.cancelled', entityType: 'order', entityId: orderId, data: { reason } });
  });
  await submitPendingRefunds(ctx, orderId);
  await cancelCarrierLabels(ctx, { orderId });
}

/** Voids carrier labels of shipments cancelled in the database (after commit; carrier cancel is idempotent). */
async function cancelCarrierLabels(ctx: Ctx, where: { orderId?: string; merchantOrderId?: string }) {
  const cancelled = await prisma.shipment.findMany({ where: { ...where, status: 'CANCELLED', carrierShipmentId: { not: null } } });
  for (const s of cancelled) {
    try {
      await ctx.carrier.cancel({ carrierShipmentId: s.carrierShipmentId! });
    } catch (e) {
      await prisma.notification.create({ data: { audience: 'OPS', type: 'shipment.cancel_failed', title: 'تعذر إلغاء بوليصة', body: `${s.trackingNumber}: ${String(e).slice(0, 200)}`, data: { shipmentId: s.id } } });
    }
  }
}

export function assertMerchantScope(merchantId: string | undefined, rowMerchantId: string) {
  if (merchantId && merchantId !== rowMerchantId) throw forbidden();
}
