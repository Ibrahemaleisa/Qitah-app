import type { OrderStatus } from '@prisma/client';

import type { Tx } from '../db.js';
import { emit, notify } from './events.js';

const STATUS_COPY: Partial<Record<OrderStatus, string>> = {
  PAID: 'تم تأكيد الدفع وإرسال طلبك للتجار',
  IN_FULFILLMENT: 'التاجر يجهّز طلبك',
  PARTIALLY_SHIPPED: 'تم شحن جزء من طلبك',
  SHIPPED: 'تم شحن طلبك',
  PARTIALLY_DELIVERED: 'تم توصيل جزء من طلبك',
  DELIVERED: 'تم توصيل طلبك',
  CANCELLED: 'تم إلغاء طلبك',
};

/** Derives the customer-facing order status from merchant suborders. Only applies to paid orders. */
export async function recomputeOrderStatus(tx: Tx, orderId: string): Promise<OrderStatus> {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { merchantOrders: true } });
  if (['PENDING_PAYMENT', 'PAYMENT_FAILED', 'EXPIRED', 'CANCELLED', 'COMPLETED'].includes(order.status)) return order.status;
  const active = order.merchantOrders.filter((m) => m.status !== 'REJECTED' && m.status !== 'CANCELLED');
  let next: OrderStatus;
  if (active.length === 0) next = 'CANCELLED';
  else if (active.every((m) => m.status === 'DELIVERED')) next = 'DELIVERED';
  else if (active.some((m) => m.status === 'DELIVERED')) next = 'PARTIALLY_DELIVERED';
  else if (active.every((m) => m.status === 'HANDED_OVER')) next = 'SHIPPED';
  else if (active.some((m) => m.status === 'HANDED_OVER')) next = 'PARTIALLY_SHIPPED';
  else if (active.some((m) => ['ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'].includes(m.status))) next = 'IN_FULFILLMENT';
  else next = 'PAID';
  if (next !== order.status) {
    await tx.order.update({
      where: { id: orderId },
      data: { status: next, ...(next === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: order.cancelReason ?? 'ALL_MERCHANTS_REJECTED' } : {}) },
    });
    await emit(tx, {
      type: 'order.status_changed',
      entityType: 'order',
      entityId: orderId,
      orderId,
      customerId: order.customerId,
      merchantIds: order.merchantOrders.map((m) => m.merchantId),
      payload: { from: order.status, to: next },
    });
    const body = STATUS_COPY[next];
    if (body) {
      await notify(tx, { audience: 'CUSTOMER', userId: order.customerId, type: 'order.status', title: `الطلب ${order.number}`, body, data: { orderId } });
    }
  }
  return next;
}
