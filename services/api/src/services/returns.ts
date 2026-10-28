import type { ShipmentPayer } from '@prisma/client';

import type { Ctx } from '../context.js';
import { prisma, withTx, type Tx } from '../db.js';
import { readFitSnapshot } from '../domain/fit.js';
import { assertTransition, RETURN_TRANSITIONS } from '../domain/states.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { returnNumber } from '../lib/ids.js';
import { applyBps } from '../lib/money.js';
import { audit, emit, notify, type Actor } from './events.js';
import { restock } from './inventory.js';
import { customerUploadPrefix } from './uploads.js';
import { createRefund, submitPendingRefunds, type Allocation } from './payments.js';
import { isGuaranteed, outboundShippingShare, quoteReturn, returnShippingPayer } from './trust.js';

export const RETURN_REASONS = ['wrongPart', 'damaged', 'notAsDescribed', 'changedMind'] as const;
const OPEN_RETURN = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'] as const;
export const AUTO_APPROVED_NOTE = 'AUTO_APPROVED_FIT_GUARANTEE';
export const MAX_RETURN_PHOTOS = 6;

export type ReturnRequestInput = {
  items: { orderItemId: string; quantity: number }[];
  reason: string;
  note?: string;
  /** Private upload keys under customers/<userId>/return/ — at least one for `damaged`. */
  photoKeys?: string[];
  /** Customer confirms the item is unopened — required for `changedMind`. */
  unopened?: boolean;
};

/** Reason-specific rules that do not need the database. */
export function validateReturnRequest(userId: string, input: ReturnRequestInput): string[] {
  const photoKeys = [...new Set(input.photoKeys ?? [])];
  if (photoKeys.length > MAX_RETURN_PHOTOS) throw badRequest('TOO_MANY_PHOTOS', `At most ${MAX_RETURN_PHOTOS} photos`);
  if (photoKeys.some((k) => !k.startsWith(customerUploadPrefix(userId, 'return')) || k.includes('..'))) throw badRequest('INVALID_PHOTO', 'Photos must be uploaded through the app');
  if (input.reason === 'damaged' && photoKeys.length < 1) throw badRequest('PHOTO_REQUIRED', 'Add at least one photo of the damage');
  if (input.reason === 'changedMind' && input.unopened !== true) throw badRequest('UNOPENED_REQUIRED', 'Change-of-mind returns are accepted for unopened items only');
  return photoKeys;
}

/**
 * Customer requests a return. Creates one case per merchant suborder; a `wrongPart` claim on lines covered by
 * the fit guarantee gets its own case, which is approved immediately with Qitah-paid return shipping.
 */
export async function requestReturn(ctx: Ctx, userId: string, orderId: string, input: ReturnRequestInput) {
  if (!input.items.length) throw badRequest('NO_ITEMS', 'Select at least one item');
  const photoKeys = validateReturnRequest(userId, input);
  return withTx(async (tx) => {
    // Serialise return requests per order so the same quantity cannot be claimed twice.
    await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} AND "customerId" = ${userId} FOR UPDATE`;
    const order = await tx.order.findFirst({ where: { id: orderId, customerId: userId }, include: { items: { include: { merchantOrder: true, returnItems: { include: { returnCase: true } } } } } });
    if (!order) throw notFound('Order');
    const cutoff = Date.now() - ctx.config.RETURN_WINDOW_DAYS * 86_400_000;
    const byCase = new Map<string, { merchantOrderId: string; guaranteed: boolean; items: { orderItemId: string; quantity: number }[] }>();
    for (const req of input.items) {
      const item = order.items.find((i) => i.id === req.orderItemId);
      if (!item || item.status !== 'ACTIVE') throw badRequest('INVALID_ITEM', 'Item is not returnable');
      const mo = item.merchantOrder;
      if (mo.status !== 'DELIVERED' || !mo.deliveredAt) throw conflict('NOT_DELIVERED', 'Items can be returned after delivery');
      if (mo.deliveredAt.getTime() < cutoff) throw conflict('RETURN_WINDOW_CLOSED', `Returns are accepted within ${ctx.config.RETURN_WINDOW_DAYS} days of delivery`);
      const already = item.returnItems.filter((r) => r.returnCase.status !== 'REJECTED').reduce((s, r) => s + r.quantity, 0);
      if (req.quantity < 1 || req.quantity > item.quantity - already) throw conflict('QUANTITY_EXCEEDED', 'Return quantity exceeds what was delivered');
      // The guarantee covers a wrong-part claim on a line whose fit was guaranteed by the server at checkout.
      const guaranteed = input.reason === 'wrongPart' && isGuaranteed(item.fitSnapshot);
      const key = `${mo.id}|${guaranteed}`;
      const entry = byCase.get(key) ?? { merchantOrderId: mo.id, guaranteed, items: [] };
      entry.items.push(req);
      byCase.set(key, entry);
    }
    const cases = [];
    for (const { merchantOrderId, guaranteed, items } of byCase.values()) {
      const mo = order.items.find((i) => i.merchantOrderId === merchantOrderId)!.merchantOrder;
      const rc = await tx.returnCase.create({
        data: {
          number: returnNumber(),
          orderId,
          merchantOrderId,
          merchantId: mo.merchantId,
          customerId: userId,
          reason: input.reason,
          customerNote: input.note,
          guaranteed,
          photoKeys,
          unopened: input.unopened === true,
          items: { create: items },
        },
      });
      cases.push(rc);
      await audit(tx, { userId, type: 'customer' }, { action: 'return.requested', entityType: 'return_case', entityId: rc.id, merchantId: mo.merchantId, data: { reason: input.reason, guaranteed, photos: photoKeys.length } });
      if (guaranteed) {
        // ضمان قطعة: no merchant decision needed. Qitah books (and pays) the pickup.
        await tx.returnCase.update({ where: { id: rc.id }, data: { status: 'APPROVED', decisionNote: AUTO_APPROVED_NOTE } });
        const shipment = await createReturnShipment(ctx, tx, rc.id);
        await notify(tx, { audience: 'CUSTOMER', userId, type: 'return.decided', title: `المرتجع ${rc.number}`, body: 'ضمان قطعة: قُبل الإرجاع تلقائياً وسنستلم القطعة على حسابنا، والاسترداد كامل مع رسوم التوصيل', data: { orderId, returnCaseId: rc.id } });
        await notify(tx, { audience: 'MERCHANT', merchantId: mo.merchantId, type: 'return.auto_approved', title: 'مرتجع بضمان قطعة', body: `${rc.number} للطلب ${mo.number}: قطعة لا تركب — قُبل تلقائياً وشحن الإرجاع على قطعة`, data: { returnCaseId: rc.id } });
        await notify(tx, { audience: 'OPS', type: 'return.auto_approved', title: 'مرتجع مضمون (قطعة خطأ)', body: `${rc.number} · شحن إرجاع ${(shipment.costHalalas / 100).toFixed(2)} ر.س على المنصة`, data: { returnCaseId: rc.id } });
        await audit(tx, { type: 'system' }, { action: 'return.auto_approved', entityType: 'return_case', entityId: rc.id, merchantId: mo.merchantId, data: { shipmentId: shipment.id, costHalalas: shipment.costHalalas } });
        await emit(tx, { type: 'return.updated', entityType: 'return_case', entityId: rc.id, orderId, customerId: userId, merchantIds: [mo.merchantId], payload: { status: 'APPROVED', guaranteed: true } });
      } else {
        await notify(tx, { audience: 'MERCHANT', merchantId: mo.merchantId, type: 'return.requested', title: 'طلب إرجاع', body: `${rc.number} للطلب ${mo.number}`, data: { returnCaseId: rc.id } });
        await notify(tx, { audience: 'OPS', type: 'return.requested', title: 'طلب إرجاع جديد', body: `${rc.number}`, data: { returnCaseId: rc.id } });
        await emit(tx, { type: 'return.updated', entityType: 'return_case', entityId: rc.id, orderId, customerId: userId, merchantIds: [mo.merchantId], payload: { status: 'REQUESTED' } });
      }
    }
    return cases;
  });
}

const returnInclude = {
  items: { include: { orderItem: { include: { offer: { include: { product: true } }, group: { include: { originLocation: true } } } } } },
  order: true,
} as const;

/** Who pays this case's return shipping (see `returnShippingPayer`). */
function payerFor(rc: { reason: string; guaranteed: boolean; items: { orderItem: { fitSnapshot: unknown } }[] }): ShipmentPayer {
  const statuses = rc.items.map((i) => readFitSnapshot(i.orderItem.fitSnapshot)?.status ?? 'noData');
  return returnShippingPayer(rc.reason, rc.guaranteed, statuses);
}

/** Creates the reverse shipment with a real sandbox quote (customer city → pickup location) and its payer. */
async function createReturnShipment(ctx: Ctx, tx: Tx, returnCaseId: string) {
  const rc = await tx.returnCase.findUniqueOrThrow({ where: { id: returnCaseId }, include: returnInclude });
  const group = rc.items[0].orderItem.group;
  const address = (rc.order.addressSnapshot ?? {}) as { city?: string };
  const quote = quoteReturn(ctx, { customerCity: address.city ?? group.originLocation.city, originCity: group.originLocation.city, lines: rc.items });
  return tx.shipment.create({
    data: {
      orderId: rc.orderId,
      merchantOrderId: rc.merchantOrderId,
      returnCaseId: rc.id,
      originLocationId: group.originLocationId,
      direction: 'RETURN',
      carrierCode: group.carrierCode,
      serviceCode: quote.serviceCode,
      sandbox: group.carrierCode === 'qitah-sandbox',
      weightGrams: rc.items.reduce((s, i) => s + i.orderItem.offer.product.weightGrams * i.quantity, 0),
      costHalalas: quote.costHalalas,
      paidBy: payerFor(rc),
    },
  });
}

async function lockReturn(tx: Tx, id: string, merchantId?: string) {
  const rows = await tx.$queryRaw<{ merchantId: string }[]>`SELECT "merchantId" FROM "ReturnCase" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length || (merchantId && rows[0].merchantId !== merchantId)) throw notFound('Return');
  return tx.returnCase.findUniqueOrThrow({ where: { id }, include: { items: { include: { orderItem: true } }, merchantOrder: true, order: true, shipments: true } });
}

/** Approve → a RETURN shipment (quoted, with its payer) is created for the control tower; reject → closed with reason. */
export async function decideReturn(ctx: Ctx, actor: Actor, id: string, approve: boolean, note: string | undefined, merchantId?: string) {
  return withTx(async (tx) => {
    const rc = await lockReturn(tx, id, merchantId);
    const to = approve ? 'APPROVED' : 'REJECTED';
    assertTransition(RETURN_TRANSITIONS, rc.status, to, 'Return');
    await tx.returnCase.update({ where: { id }, data: { status: to, decisionNote: note } });
    if (approve) await createReturnShipment(ctx, tx, id);
    await notify(tx, {
      audience: 'CUSTOMER',
      userId: rc.customerId,
      type: 'return.decided',
      title: `المرتجع ${rc.number}`,
      body: approve ? 'تمت الموافقة على الإرجاع وسنرتب الاستلام' : `تم رفض طلب الإرجاع${note ? `: ${note}` : ''}`,
      data: { orderId: rc.orderId, returnCaseId: rc.id },
    });
    await audit(tx, actor, { action: `return.${to.toLowerCase()}`, entityType: 'return_case', entityId: id, merchantId: rc.merchantId, data: { note } });
    await emit(tx, { type: 'return.updated', entityType: 'return_case', entityId: id, orderId: rc.orderId, customerId: rc.customerId, merchantIds: [rc.merchantId], payload: { status: to } });
    return tx.returnCase.findUniqueOrThrow({ where: { id } });
  });
}

/** Item received back (carrier delivery, or manual drop-off confirmation). */
export async function markReturnReceived(actor: Actor, id: string, merchantId?: string) {
  return withTx(async (tx) => {
    const rc = await lockReturn(tx, id, merchantId);
    assertTransition(RETURN_TRANSITIONS, rc.status, 'RECEIVED', 'Return');
    await tx.returnCase.update({ where: { id }, data: { status: 'RECEIVED' } });
    // Received by hand (e.g. customer drop-off): any reverse shipment not yet collected is no longer needed.
    const open = await tx.shipment.findMany({ where: { returnCaseId: id, status: { in: ['PENDING', 'LABEL_CREATED', 'PICKUP_SCHEDULED', 'PICKUP_FAILED'] } } });
    for (const s of open) {
      await tx.shipment.update({ where: { id: s.id }, data: { status: 'CANCELLED' } });
      await tx.shipmentEvent.create({ data: { shipmentId: s.id, status: 'CANCELLED', description: 'Return received without carrier', source: 'SYSTEM', actorUserId: actor.userId, occurredAt: new Date() } });
    }
    await audit(tx, actor, { action: 'return.received', entityType: 'return_case', entityId: id, merchantId: rc.merchantId });
    await emit(tx, { type: 'return.updated', entityType: 'return_case', entityId: id, orderId: rc.orderId, customerId: rc.customerId, merchantIds: [rc.merchantId], payload: { status: 'RECEIVED' } });
    return tx.returnCase.findUniqueOrThrow({ where: { id } });
  });
}

/**
 * Refund for an accepted return.
 * - Guaranteed wrong part: full item value (merchant-funded, as the merchant gets the item back) plus the lines'
 *   share of outbound shipping, funded by Qitah and booked to GUARANTEE_EXPENSE.
 * - Customer-paid return shipping (change of mind): the label cost is deducted and owed to the carrier.
 */
export async function computeReturnRefund(
  tx: Tx,
  rc: Awaited<ReturnType<typeof lockReturn>>,
  requestedItems: number | undefined,
): Promise<{ amount: number; allocation: Allocation; deduction: number; platformShipping: number }> {
  const itemValue = rc.items.reduce((s, i) => s + i.orderItem.unitPriceHalalas * i.quantity, 0);
  if (rc.guaranteed && requestedItems !== undefined && requestedItems !== itemValue) {
    throw conflict('GUARANTEE_FULL_REFUND', 'Fit-guarantee returns are refunded in full');
  }
  const items = requestedItems ?? itemValue;
  if (!Number.isSafeInteger(items) || items <= 0 || items > itemValue) throw badRequest('INVALID_AMOUNT', `Refund must be between 1 and ${itemValue} halalas`);
  let platformShipping = 0;
  if (rc.guaranteed) {
    const groupIds = [...new Set(rc.items.map((i) => i.orderItem.fulfillmentGroupId))];
    const groups = await tx.fulfillmentGroup.findMany({ where: { id: { in: groupIds } }, include: { items: { orderBy: { id: 'asc' } } } });
    for (const i of rc.items) {
      const g = groups.find((x) => x.id === i.orderItem.fulfillmentGroupId)!;
      platformShipping += outboundShippingShare(g, i.orderItemId, i.quantity, i.orderItem.quantity);
    }
  }
  // Customer-paid reverse labels that were actually bought (a tracking number exists).
  const deduction = rc.shipments.filter((s) => s.direction === 'RETURN' && s.paidBy === 'CUSTOMER' && s.trackingNumber).reduce((s, x) => s + x.costHalalas, 0);
  const amount = items + platformShipping - deduction;
  if (amount <= 0) throw conflict('REFUND_NOT_POSITIVE', 'Return shipping exceeds the refundable value; reject the return instead');
  const allocation: Allocation = [
    {
      merchantId: rc.merchantId,
      merchantOrderId: rc.merchantOrderId,
      items,
      commission: applyBps(items, rc.merchantOrder.commissionBps),
      // Negative: the retained return-shipping charge becomes owed to the carrier.
      shipping: -deduction,
      ...(platformShipping ? { platformShipping } : {}),
    },
  ];
  return { amount, allocation, deduction, platformShipping };
}

/**
 * Inspection outcome. Accepted → refund (full item value by default, or a smaller partial amount) and optional restock.
 * The case becomes REFUNDED when the provider confirms the refund via webhook.
 */
export async function inspectReturn(
  ctx: Ctx,
  actor: Actor,
  id: string,
  input: { accept: boolean; restock: boolean; refundHalalas?: number; note?: string },
  merchantId?: string,
) {
  const orderId = await withTx(async (tx) => {
    const rc = await lockReturn(tx, id, merchantId);
    if (rc.status !== 'RECEIVED') throw conflict('INVALID_TRANSITION', `Return is ${rc.status}`);
    // The case stays RECEIVED until the refund webhook lands; never inspect (and restock) twice.
    if (rc.inspectedAt) throw conflict('ALREADY_INSPECTED', 'This return was already inspected');
    await tx.returnCase.update({ where: { id }, data: { inspectedAt: new Date() } });
    if (!input.accept) {
      await tx.returnCase.update({ where: { id }, data: { status: 'CLOSED', inspectionNote: input.note } });
      await notify(tx, { audience: 'CUSTOMER', userId: rc.customerId, type: 'return.inspection_failed', title: `المرتجع ${rc.number}`, body: `لم يجتز المرتجع الفحص${input.note ? `: ${input.note}` : ''}`, data: { orderId: rc.orderId } });
    } else {
      const refund = await computeReturnRefund(tx, rc, input.refundHalalas);
      if (input.restock) {
        for (const i of rc.items) await restock(tx, { offerId: i.orderItem.offerId, quantity: i.quantity, reason: 'RETURN_RESTOCK', refType: 'return_case', refId: rc.id, actor });
      }
      const payment = await tx.payment.findFirst({ where: { orderId: rc.orderId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } });
      if (!payment) throw conflict('NOT_REFUNDABLE', 'No captured payment for this order');
      await createRefund(tx, {
        payment,
        amountHalalas: refund.amount,
        reason: `RETURN:${rc.reason}${rc.guaranteed ? ':GUARANTEE' : ''}`,
        allocation: refund.allocation,
        idempotencyKey: `return:${rc.id}`,
        returnCaseId: rc.id,
        actor,
      });
      await tx.returnCase.update({ where: { id }, data: { inspectionNote: input.note, restock: input.restock, refundHalalas: refund.amount } });
    }
    await audit(tx, actor, { action: input.accept ? 'return.inspection_accepted' : 'return.inspection_rejected', entityType: 'return_case', entityId: id, merchantId: rc.merchantId, data: input });
    await emit(tx, { type: 'return.updated', entityType: 'return_case', entityId: id, orderId: rc.orderId, customerId: rc.customerId, merchantIds: [rc.merchantId] });
    return rc.orderId;
  });
  await submitPendingRefunds(ctx, orderId);
  return prisma.returnCase.findUniqueOrThrow({ where: { id }, include: { refunds: true } });
}

export const isOpenReturn = (status: string) => (OPEN_RETURN as readonly string[]).includes(status);

/** Signed, short-lived URLs for a case's photos (merchant / ops review). */
export async function returnPhotoUrls(ctx: Ctx, photoKeys: string[]) {
  return Promise.all(photoKeys.map(async (key) => ({ key, url: await ctx.uploads.downloadUrl(key) })));
}
