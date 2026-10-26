import { Prisma, type ShipmentStatus } from '@prisma/client';

import type { Ctx } from '../context.js';
import { prisma, withTx, type Tx } from '../db.js';
import { assertTransition, COLLECTED, MERCHANT_ORDER_TRANSITIONS, RETURN_TRANSITIONS, SHIPMENT_TRANSITIONS } from '../domain/states.js';
import { conflict, notFound } from '../lib/errors.js';
import { audit, emit, notify, type Actor } from './events.js';
import { recomputeOrderStatus } from './orders.js';

const CUSTOMER_COPY: Partial<Record<ShipmentStatus, string>> = {
  PICKED_UP: 'استلمت شركة الشحن شحنتك',
  OUT_FOR_DELIVERY: 'شحنتك في الطريق إليك اليوم',
  DELIVERED: 'تم تسليم شحنتك',
  DELIVERY_FAILED: 'تعذر تسليم شحنتك — سنعيد المحاولة',
};

/** Creates PENDING outbound shipments for every fulfilment group of a merchant order that lacks one. */
export async function ensureOutboundShipments(tx: Tx, merchantOrderId: string) {
  const groups = await tx.fulfillmentGroup.findMany({
    where: { merchantOrderId },
    include: { shipments: { where: { direction: 'OUTBOUND', status: { notIn: ['CANCELLED'] } } }, items: { where: { status: 'ACTIVE' } } },
  });
  const created = [];
  for (const g of groups) {
    if (g.shipments.length || !g.items.length) continue;
    created.push(
      await tx.shipment.create({
        data: {
          orderId: g.orderId,
          merchantOrderId,
          fulfillmentGroupId: g.id,
          originLocationId: g.originLocationId,
          carrierCode: g.carrierCode,
          serviceCode: g.serviceCode,
          sandbox: g.carrierCode === 'qitah-sandbox',
          weightGrams: g.weightGrams,
          costHalalas: g.quotedHalalas,
        },
      }),
    );
  }
  return created;
}

async function lockShipment(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Shipment" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) throw notFound('Shipment');
  return tx.shipment.findUniqueOrThrow({
    where: { id },
    include: { order: true, merchantOrder: true, originLocation: true, returnCase: true },
  });
}

/** Buys a label from the carrier. Carrier call happens outside the DB transaction. */
export async function createLabel(ctx: Ctx, actor: Actor, shipmentId: string) {
  const s = await prisma.shipment.findUnique({ where: { id: shipmentId }, include: { order: true, originLocation: true, merchantOrder: { include: { merchant: true } } } });
  if (!s) throw notFound('Shipment');
  if (s.status !== 'PENDING') throw conflict('INVALID_TRANSITION', `Shipment is ${s.status}`);
  if (s.direction === 'OUTBOUND' && !['READY_FOR_PICKUP', 'PACKING'].includes(s.merchantOrder.status)) {
    throw conflict('NOT_READY', 'Merchant has not marked the order ready');
  }
  const addr = s.order.addressSnapshot as Record<string, string>;
  const loc = { name: s.merchantOrder.merchant.displayNameAr, city: s.originLocation.city, district: s.originLocation.district, street: s.originLocation.street, phone: s.originLocation.contactPhone };
  const cust = { name: addr.contactName, city: addr.city, district: addr.district, street: addr.street, phone: addr.phone };
  const created = await ctx.carrier.createShipment({
    shipmentId: s.id,
    serviceCode: s.serviceCode,
    origin: s.direction === 'OUTBOUND' ? loc : cust,
    destination: s.direction === 'OUTBOUND' ? cust : loc,
    weightGrams: s.weightGrams,
    reference: s.merchantOrder.number,
  });
  return withTx(async (tx) => {
    const locked = await lockShipment(tx, shipmentId);
    if (locked.status !== 'PENDING') throw conflict('INVALID_TRANSITION', `Shipment is ${locked.status}`);
    await tx.shipment.update({ where: { id: shipmentId }, data: { ...created, status: 'LABEL_CREATED' } });
    await tx.shipmentEvent.create({
      data: { shipmentId, status: 'LABEL_CREATED', description: ctx.carrier.sandbox ? 'Sandbox label created (not valid for real shipping)' : 'Label created', source: 'OPS', actorUserId: actor.userId, occurredAt: new Date() },
    });
    await audit(tx, actor, { action: 'shipment.label_created', entityType: 'shipment', entityId: shipmentId, merchantId: locked.merchantOrder.merchantId, data: { trackingNumber: created.trackingNumber } });
    await emit(tx, { type: 'shipment.updated', entityType: 'shipment', entityId: shipmentId, orderId: locked.orderId, customerId: locked.order.customerId, merchantIds: [locked.merchantOrder.merchantId], payload: { status: 'LABEL_CREATED' } });
    return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  });
}

export async function schedulePickup(ctx: Ctx, actor: Actor, shipmentId: string, windowStart: Date, windowEnd: Date) {
  if (windowEnd <= windowStart) throw conflict('INVALID_WINDOW', 'Pickup window end must be after start');
  const s = await prisma.shipment.findUnique({ where: { id: shipmentId } });
  if (!s) throw notFound('Shipment');
  if (!['LABEL_CREATED', 'PICKUP_FAILED'].includes(s.status) || !s.carrierShipmentId) throw conflict('INVALID_TRANSITION', `Shipment is ${s.status}`);
  const res = await ctx.carrier.schedulePickup({ carrierShipmentId: s.carrierShipmentId, windowStart, windowEnd });
  return withTx(async (tx) => {
    const locked = await lockShipment(tx, shipmentId);
    if (!['LABEL_CREATED', 'PICKUP_FAILED'].includes(locked.status)) throw conflict('INVALID_TRANSITION', `Shipment is ${locked.status}`);
    await tx.shipment.update({ where: { id: shipmentId }, data: { status: 'PICKUP_SCHEDULED', pickupWindowStart: windowStart, pickupWindowEnd: windowEnd, exceptionReason: null } });
    await tx.shipmentEvent.create({
      data: { shipmentId, status: 'PICKUP_SCHEDULED', description: `Pickup booked (${res.confirmationId})`, source: 'OPS', actorUserId: actor.userId, occurredAt: new Date() },
    });
    await notify(tx, {
      audience: 'MERCHANT',
      merchantId: locked.merchantOrder.merchantId,
      type: 'shipment.pickup_scheduled',
      title: 'موعد استلام الشحنة',
      body: `سيصل المندوب لاستلام ${locked.merchantOrder.number}`,
      data: { shipmentId, windowStart: windowStart.toISOString(), windowEnd: windowEnd.toISOString() },
    });
    await audit(tx, actor, { action: 'shipment.pickup_scheduled', entityType: 'shipment', entityId: shipmentId, merchantId: locked.merchantOrder.merchantId });
    await emit(tx, { type: 'shipment.updated', entityType: 'shipment', entityId: shipmentId, orderId: locked.orderId, customerId: locked.order.customerId, merchantIds: [locked.merchantOrder.merchantId], payload: { status: 'PICKUP_SCHEDULED' } });
    return tx.shipment.findUniqueOrThrow({ where: { id: shipmentId } });
  });
}

export type TrackingInput = {
  shipmentId: string;
  status: ShipmentStatus;
  description: string;
  location?: string;
  source: 'CARRIER' | 'OPS' | 'MERCHANT' | 'SYSTEM';
  externalEventId?: string;
  occurredAt?: Date;
  actor: Actor;
};

/** Applies one tracking event with all downstream effects. Idempotent on externalEventId. */
export async function applyTrackingEvent(tx: Tx, input: TrackingInput): Promise<{ applied: boolean }> {
  if (input.externalEventId) {
    const dup = await tx.shipmentEvent.findUnique({ where: { externalEventId: input.externalEventId } });
    if (dup) return { applied: false };
  }
  const s = await lockShipment(tx, input.shipmentId);
  assertTransition(SHIPMENT_TRANSITIONS, s.status, input.status, 'Shipment');
  const exceptional = ['PICKUP_FAILED', 'DELIVERY_FAILED', 'EXCEPTION'].includes(input.status);
  await tx.shipment.update({ where: { id: s.id }, data: { status: input.status, exceptionReason: exceptional ? input.description : null } });
  try {
    await tx.shipmentEvent.create({
      data: {
        shipmentId: s.id,
        status: input.status,
        description: input.description,
        location: input.location,
        source: input.source,
        externalEventId: input.externalEventId,
        actorUserId: input.actor.userId,
        occurredAt: input.occurredAt ?? new Date(),
      },
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('DUPLICATE_EVENT', 'Event already recorded');
    throw e;
  }
  const merchantId = s.merchantOrder.merchantId;

  if (s.direction === 'OUTBOUND') {
    await advanceMerchantOrder(tx, s.merchantOrderId, input.actor);
    const copy = CUSTOMER_COPY[input.status];
    if (copy) await notify(tx, { audience: 'CUSTOMER', userId: s.order.customerId, type: 'shipment.status', title: `الطلب ${s.order.number}`, body: copy, data: { orderId: s.orderId, shipmentId: s.id } });
  } else if (s.returnCase) {
    const rc = s.returnCase;
    const target = COLLECTED.includes(input.status) && input.status !== 'DELIVERED' ? 'IN_TRANSIT' : input.status === 'DELIVERED' ? 'RECEIVED' : null;
    if (target && rc.status !== target && RETURN_TRANSITIONS[rc.status].includes(target)) {
      await tx.returnCase.update({ where: { id: rc.id }, data: { status: target } });
      if (target === 'RECEIVED') {
        await notify(tx, { audience: 'MERCHANT', merchantId, type: 'return.received', title: 'مرتجع وصل', body: `المرتجع ${rc.number} بانتظار الفحص`, data: { returnCaseId: rc.id } });
      }
    }
  }
  if (exceptional) {
    await notify(tx, { audience: 'OPS', type: 'shipment.exception', title: 'استثناء شحن', body: `${s.merchantOrder.number}: ${input.description}`, data: { shipmentId: s.id } });
    if (input.status === 'PICKUP_FAILED') {
      await notify(tx, { audience: 'MERCHANT', merchantId, type: 'shipment.pickup_failed', title: 'تعذر استلام الشحنة', body: `${s.merchantOrder.number}: ${input.description}`, data: { shipmentId: s.id } });
    }
  }
  await recomputeOrderStatus(tx, s.orderId);
  await emit(tx, { type: 'shipment.updated', entityType: 'shipment', entityId: s.id, orderId: s.orderId, customerId: s.order.customerId, merchantIds: [merchantId], payload: { status: input.status } });
  return { applied: true };
}

/** Moves a merchant order to HANDED_OVER / DELIVERED once all its live outbound shipments are collected / delivered. */
async function advanceMerchantOrder(tx: Tx, merchantOrderId: string, actor: Actor) {
  const mo = await tx.merchantOrder.findUniqueOrThrow({ where: { id: merchantOrderId }, include: { shipments: { where: { direction: 'OUTBOUND', status: { not: 'CANCELLED' } } } } });
  if (!mo.shipments.length) return;
  const now = new Date();
  if (mo.status === 'READY_FOR_PICKUP' && mo.shipments.every((x) => COLLECTED.includes(x.status))) {
    assertTransition(MERCHANT_ORDER_TRANSITIONS, mo.status, 'HANDED_OVER', 'Merchant order');
    await tx.merchantOrder.update({ where: { id: mo.id }, data: { status: 'HANDED_OVER', handedOverAt: now } });
    mo.status = 'HANDED_OVER';
    await audit(tx, actor, { action: 'merchant_order.handed_over', entityType: 'merchant_order', entityId: mo.id, merchantId: mo.merchantId });
  }
  if (mo.status === 'HANDED_OVER' && mo.shipments.every((x) => x.status === 'DELIVERED')) {
    await tx.merchantOrder.update({ where: { id: mo.id }, data: { status: 'DELIVERED', deliveredAt: now } });
    await audit(tx, actor, { action: 'merchant_order.delivered', entityType: 'merchant_order', entityId: mo.id, merchantId: mo.merchantId });
  }
}

export async function recordTrackingEvent(input: TrackingInput) {
  return withTx((tx) => applyTrackingEvent(tx, input));
}
