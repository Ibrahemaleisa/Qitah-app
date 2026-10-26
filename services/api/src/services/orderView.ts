import type { Prisma } from '@prisma/client';

import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';

export const orderInclude = {
  merchantOrders: { include: { merchant: { select: { id: true, displayNameAr: true, displayNameEn: true, city: true } } }, orderBy: { number: 'asc' } },
  items: true,
  groups: { include: { originLocation: { select: { city: true } } } },
  shipments: { include: { events: { orderBy: { occurredAt: 'asc' } }, originLocation: { select: { city: true, name: true } } }, orderBy: { createdAt: 'asc' } },
  payments: { orderBy: { createdAt: 'asc' } },
  refunds: { orderBy: { createdAt: 'asc' } },
  returnCases: { include: { items: true }, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.OrderInclude;

export type OrderFull = Prisma.OrderGetPayload<{ include: typeof orderInclude }>;

/** Customer-safe order view: no commissions, no internal notes, no provider payloads. */
export function presentCustomerOrder(o: OrderFull) {
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    sandbox: o.sandbox,
    createdAt: o.createdAt.toISOString(),
    paidAt: o.paidAt?.toISOString() ?? null,
    paymentExpiresAt: o.paymentExpiresAt.toISOString(),
    paymentMethod: o.paymentMethod,
    address: o.addressSnapshot,
    vehicle: o.vehicleSnapshot,
    totals: { itemsHalalas: o.itemsHalalas, shippingHalalas: o.shippingHalalas, discountHalalas: o.discountHalalas, totalHalalas: o.totalHalalas, vatHalalas: o.vatHalalas, refundedHalalas: o.refundedHalalas },
    cancelReason: o.cancelReason,
    merchantOrders: o.merchantOrders.map((m) => ({
      id: m.id,
      number: m.number,
      status: m.status,
      merchant: { id: m.merchant.id, nameAr: m.merchant.displayNameAr, nameEn: m.merchant.displayNameEn, city: m.merchant.city },
      itemsHalalas: m.itemsHalalas,
      shippingHalalas: m.shippingHalalas,
      deliveredAt: m.deliveredAt?.toISOString() ?? null,
    })),
    items: o.items.map((i) => ({
      id: i.id,
      merchantOrderId: i.merchantOrderId,
      fulfillmentGroupId: i.fulfillmentGroupId,
      offerId: i.offerId,
      productId: i.productId,
      nameAr: i.productNameAr,
      nameEn: i.productNameEn,
      partNumber: i.partNumber,
      condition: i.condition.toLowerCase(),
      art: i.art,
      quantity: i.quantity,
      unitPriceHalalas: i.unitPriceHalalas,
      lineTotalHalalas: i.lineTotalHalalas,
      status: i.status,
    })),
    shipmentGroups: o.groups.map((g) => {
      const shipment = [...o.shipments].reverse().find((s) => s.fulfillmentGroupId === g.id && s.direction === 'OUTBOUND');
      return {
        id: g.id,
        merchantOrderId: g.merchantOrderId,
        serviceCode: g.serviceCode,
        carrierCode: g.carrierCode,
        shippingHalalas: g.quotedHalalas,
        etaDaysMin: g.etaDaysMin,
        etaDaysMax: g.etaDaysMax,
        originCity: g.originLocation.city,
        shipment: shipment && {
          id: shipment.id,
          status: shipment.status,
          trackingNumber: shipment.trackingNumber,
          sandbox: shipment.sandbox,
          events: shipment.events.map((e) => ({ status: e.status, description: e.description, location: e.location, occurredAt: e.occurredAt.toISOString() })),
        },
      };
    }),
    payment: (() => {
      const p = [...o.payments].reverse().find((x) => x.status !== 'CANCELLED') ?? o.payments.at(-1);
      return p ? { id: p.id, status: p.status, method: p.method, sandbox: p.sandbox, redirectUrl: p.status === 'INITIATED' ? p.redirectUrl : null } : null;
    })(),
    refunds: o.refunds.filter((r) => (r.allocation as unknown[]).length > 0).map((r) => ({ id: r.id, amountHalalas: r.amountHalalas, status: r.status, reason: r.reason, createdAt: r.createdAt.toISOString() })),
    returns: o.returnCases.map((r) => ({
      id: r.id,
      number: r.number,
      status: r.status,
      reason: r.reason,
      refundHalalas: r.refundHalalas,
      items: r.items.map((i) => ({ orderItemId: i.orderItemId, quantity: i.quantity })),
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

export async function loadOrder(id: string, where: Prisma.OrderWhereInput = {}) {
  const o = await prisma.order.findFirst({ where: { id, ...where }, include: orderInclude });
  if (!o) throw notFound('Order');
  return o;
}
