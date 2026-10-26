import type { Ctx } from '../context.js';
import { prisma, withTx, type Tx } from '../db.js';
import { assertTransition, RETURN_TRANSITIONS } from '../domain/states.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { returnNumber } from '../lib/ids.js';
import { applyBps } from '../lib/money.js';
import { audit, emit, notify, type Actor } from './events.js';
import { restock } from './inventory.js';
import { createRefund, submitPendingRefunds } from './payments.js';

export const RETURN_REASONS = ['wrongPart', 'damaged', 'notAsDescribed', 'changedMind'] as const;
const OPEN_RETURN = ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'] as const;

/** Customer requests a return. Creates one case per merchant suborder. */
export async function requestReturn(
  ctx: Ctx,
  userId: string,
  orderId: string,
  input: { items: { orderItemId: string; quantity: number }[]; reason: string; note?: string },
) {
  if (!input.items.length) throw badRequest('NO_ITEMS', 'Select at least one item');
  return withTx(async (tx) => {
    const order = await tx.order.findFirst({ where: { id: orderId, customerId: userId }, include: { items: { include: { merchantOrder: true, returnItems: { include: { returnCase: true } } } } } });
    if (!order) throw notFound('Order');
    const cutoff = Date.now() - ctx.config.RETURN_WINDOW_DAYS * 86_400_000;
    const byMo = new Map<string, { orderItemId: string; quantity: number }[]>();
    for (const req of input.items) {
      const item = order.items.find((i) => i.id === req.orderItemId);
      if (!item || item.status !== 'ACTIVE') throw badRequest('INVALID_ITEM', 'Item is not returnable');
      const mo = item.merchantOrder;
      if (mo.status !== 'DELIVERED' || !mo.deliveredAt) throw conflict('NOT_DELIVERED', 'Items can be returned after delivery');
      if (mo.deliveredAt.getTime() < cutoff) throw conflict('RETURN_WINDOW_CLOSED', `Returns are accepted within ${ctx.config.RETURN_WINDOW_DAYS} days of delivery`);
      const already = item.returnItems.filter((r) => r.returnCase.status !== 'REJECTED').reduce((s, r) => s + r.quantity, 0);
      if (req.quantity < 1 || req.quantity > item.quantity - already) throw conflict('QUANTITY_EXCEEDED', 'Return quantity exceeds what was delivered');
      byMo.set(mo.id, [...(byMo.get(mo.id) ?? []), req]);
    }
    const cases = [];
    for (const [merchantOrderId, items] of byMo) {
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
          items: { create: items },
        },
      });
      cases.push(rc);
      await notify(tx, { audience: 'MERCHANT', merchantId: mo.merchantId, type: 'return.requested', title: 'طلب إرجاع', body: `${rc.number} للطلب ${mo.number}`, data: { returnCaseId: rc.id } });
      await notify(tx, { audience: 'OPS', type: 'return.requested', title: 'طلب إرجاع جديد', body: `${rc.number}`, data: { returnCaseId: rc.id } });
      await audit(tx, { userId, type: 'customer' }, { action: 'return.requested', entityType: 'return_case', entityId: rc.id, merchantId: mo.merchantId });
      await emit(tx, { type: 'return.updated', entityType: 'return_case', entityId: rc.id, orderId, customerId: userId, merchantIds: [mo.merchantId], payload: { status: 'REQUESTED' } });
    }
    return cases;
  });
}

async function lockReturn(tx: Tx, id: string, merchantId?: string) {
  const rows = await tx.$queryRaw<{ merchantId: string }[]>`SELECT "merchantId" FROM "ReturnCase" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length || (merchantId && rows[0].merchantId !== merchantId)) throw notFound('Return');
  return tx.returnCase.findUniqueOrThrow({ where: { id }, include: { items: { include: { orderItem: true } }, merchantOrder: true, order: true } });
}

/** Approve → a RETURN shipment is created for the control tower; reject → closed with reason. */
export async function decideReturn(actor: Actor, id: string, approve: boolean, note: string | undefined, merchantId?: string) {
  return withTx(async (tx) => {
    const rc = await lockReturn(tx, id, merchantId);
    const to = approve ? 'APPROVED' : 'REJECTED';
    assertTransition(RETURN_TRANSITIONS, rc.status, to, 'Return');
    await tx.returnCase.update({ where: { id }, data: { status: to, decisionNote: note } });
    if (approve) {
      const group = await tx.fulfillmentGroup.findUniqueOrThrow({ where: { id: rc.items[0].orderItem.fulfillmentGroupId } });
      await tx.shipment.create({
        data: {
          orderId: rc.orderId,
          merchantOrderId: rc.merchantOrderId,
          returnCaseId: rc.id,
          originLocationId: group.originLocationId,
          direction: 'RETURN',
          carrierCode: group.carrierCode,
          serviceCode: 'standard',
          sandbox: group.carrierCode === 'qitah-sandbox',
          weightGrams: group.weightGrams,
          costHalalas: 0,
        },
      });
    }
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
    if (!input.accept) {
      await tx.returnCase.update({ where: { id }, data: { status: 'CLOSED', inspectionNote: input.note } });
      await notify(tx, { audience: 'CUSTOMER', userId: rc.customerId, type: 'return.inspection_failed', title: `المرتجع ${rc.number}`, body: `لم يجتز المرتجع الفحص${input.note ? `: ${input.note}` : ''}`, data: { orderId: rc.orderId } });
    } else {
      const itemValue = rc.items.reduce((s, i) => s + i.orderItem.unitPriceHalalas * i.quantity, 0);
      const amount = input.refundHalalas ?? itemValue;
      if (!Number.isSafeInteger(amount) || amount <= 0 || amount > itemValue) throw badRequest('INVALID_AMOUNT', `Refund must be between 1 and ${itemValue} halalas`);
      if (input.restock) {
        for (const i of rc.items) await restock(tx, { offerId: i.orderItem.offerId, quantity: i.quantity, reason: 'RETURN_RESTOCK', refType: 'return_case', refId: rc.id, actor });
      }
      const payment = await tx.payment.findFirst({ where: { orderId: rc.orderId, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } });
      if (!payment) throw conflict('NOT_REFUNDABLE', 'No captured payment for this order');
      await createRefund(tx, {
        payment,
        amountHalalas: amount,
        reason: `RETURN:${rc.reason}`,
        allocation: [{ merchantId: rc.merchantId, merchantOrderId: rc.merchantOrderId, items: amount, commission: applyBps(amount, rc.merchantOrder.commissionBps), shipping: 0 }],
        idempotencyKey: `return:${rc.id}`,
        returnCaseId: rc.id,
        actor,
      });
      await tx.returnCase.update({ where: { id }, data: { inspectionNote: input.note, restock: input.restock, refundHalalas: amount } });
    }
    await audit(tx, actor, { action: input.accept ? 'return.inspection_accepted' : 'return.inspection_rejected', entityType: 'return_case', entityId: id, merchantId: rc.merchantId, data: input });
    await emit(tx, { type: 'return.updated', entityType: 'return_case', entityId: id, orderId: rc.orderId, customerId: rc.customerId, merchantIds: [rc.merchantId] });
    return rc.orderId;
  });
  await submitPendingRefunds(ctx, orderId);
  return prisma.returnCase.findUniqueOrThrow({ where: { id }, include: { refunds: true } });
}

export const isOpenReturn = (status: string) => (OPEN_RETURN as readonly string[]).includes(status);
