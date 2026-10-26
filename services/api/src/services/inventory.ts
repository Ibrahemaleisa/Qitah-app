import type { AdjustmentReason } from '@prisma/client';

import type { Tx } from '../db.js';
import { conflict, notFound } from '../lib/errors.js';
import type { Actor } from './events.js';

/**
 * Stock model: InventoryLevel.onHand (physical units at the merchant) and .reserved (held for unpaid/paid
 * orders not yet committed). Every mutation is a single conditional UPDATE so concurrent checkouts can
 * never oversell; CHECK constraints are the last line of defence.
 */

export async function available(tx: Tx, offerId: string): Promise<number> {
  const lvl = await tx.inventoryLevel.findUnique({ where: { offerId } });
  return lvl ? lvl.onHand - lvl.reserved : 0;
}

export async function reserve(tx: Tx, input: { offerId: string; quantity: number; orderId: string; orderItemId: string; expiresAt: Date }) {
  const updated = await tx.$executeRaw`
    UPDATE "InventoryLevel" SET "reserved" = "reserved" + ${input.quantity}, "updatedAt" = now()
    WHERE "offerId" = ${input.offerId} AND "onHand" - "reserved" >= ${input.quantity}`;
  if (updated !== 1) {
    throw conflict('INSUFFICIENT_STOCK', 'Not enough stock for one or more items', {
      offerId: input.offerId,
      available: await available(tx, input.offerId),
      requested: input.quantity,
    });
  }
  await tx.inventoryReservation.create({ data: { ...input, status: 'ACTIVE' } });
}

/** Payment captured: reserved units leave stock for good. */
export async function commitOrder(tx: Tx, orderId: string) {
  const reservations = await tx.inventoryReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
  for (const r of reservations) {
    const lvl = await tx.inventoryLevel.update({
      where: { offerId: r.offerId },
      data: { onHand: { decrement: r.quantity }, reserved: { decrement: r.quantity } },
    });
    await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: 'COMMITTED' } });
    await tx.inventoryAdjustment.create({
      data: { offerId: r.offerId, delta: -r.quantity, onHandAfter: lvl.onHand, reason: 'SALE', refType: 'order', refId: orderId },
    });
  }
  return reservations.length;
}

/** Unpaid order expired/cancelled: release holds. Idempotent. */
export async function releaseOrder(tx: Tx, orderId: string) {
  const reservations = await tx.inventoryReservation.findMany({ where: { orderId, status: 'ACTIVE' } });
  for (const r of reservations) {
    await tx.inventoryLevel.update({ where: { offerId: r.offerId }, data: { reserved: { decrement: r.quantity } } });
    await tx.inventoryReservation.update({ where: { id: r.id }, data: { status: 'RELEASED' } });
  }
  return reservations.length;
}

/** Adds units back on hand (cancellation after commit, or accepted return). */
export async function restock(tx: Tx, input: { offerId: string; quantity: number; reason: AdjustmentReason; refType: string; refId: string; actor?: Actor }) {
  const lvl = await tx.inventoryLevel.update({ where: { offerId: input.offerId }, data: { onHand: { increment: input.quantity } } });
  await tx.inventoryAdjustment.create({
    data: { offerId: input.offerId, delta: input.quantity, onHandAfter: lvl.onHand, reason: input.reason, refType: input.refType, refId: input.refId, actorUserId: input.actor?.userId },
  });
}

/** Merchant sets the physical count. Refuses to go below units already reserved for orders. */
export async function setOnHand(tx: Tx, input: { offerId: string; onHand: number; reason: AdjustmentReason; note?: string; actor: Actor }) {
  const rows = await tx.$queryRaw<{ onHand: number; reserved: number }[]>`
    SELECT "onHand", "reserved" FROM "InventoryLevel" WHERE "offerId" = ${input.offerId} FOR UPDATE`;
  if (!rows.length) throw notFound('Inventory');
  const { onHand, reserved } = rows[0];
  if (input.onHand < reserved) {
    throw conflict('BELOW_RESERVED', `Cannot set stock below ${reserved} units reserved for open orders`, { reserved });
  }
  const delta = input.onHand - onHand;
  if (delta === 0) return { onHand, reserved };
  await tx.inventoryLevel.update({ where: { offerId: input.offerId }, data: { onHand: input.onHand } });
  await tx.inventoryAdjustment.create({
    data: { offerId: input.offerId, delta, onHandAfter: input.onHand, reason: input.reason, note: input.note, actorUserId: input.actor.userId },
  });
  return { onHand: input.onHand, reserved };
}
