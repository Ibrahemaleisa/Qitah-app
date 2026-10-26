import type { Audience, Prisma } from '@prisma/client';

import type { Db } from '../db.js';

export type Actor = { userId?: string; type: 'customer' | 'merchant' | 'ops' | 'system' | 'carrier' | 'payment_provider' };
export const SYSTEM: Actor = { type: 'system' };

/** Outbox event, written in the caller's transaction. Drives workers and realtime streams. */
export async function emit(
  db: Db,
  e: { type: string; entityType: string; entityId: string; orderId?: string; customerId?: string; merchantIds?: string[]; payload?: Prisma.InputJsonValue },
) {
  await db.domainEvent.create({
    data: {
      type: e.type,
      entityType: e.entityType,
      entityId: e.entityId,
      orderId: e.orderId,
      customerId: e.customerId,
      merchantIds: e.merchantIds ?? [],
      payload: e.payload ?? {},
    },
  });
}

export async function audit(
  db: Db,
  actor: Actor,
  a: { action: string; entityType: string; entityId: string; merchantId?: string; data?: Prisma.InputJsonValue; requestId?: string },
) {
  await db.auditEvent.create({
    data: { actorUserId: actor.userId, actorType: actor.type, merchantId: a.merchantId, action: a.action, entityType: a.entityType, entityId: a.entityId, data: a.data, requestId: a.requestId },
  });
}

export async function notify(
  db: Db,
  n: { audience: Audience; userId?: string; merchantId?: string; type: string; title: string; body: string; data?: Prisma.InputJsonValue },
) {
  await db.notification.create({ data: { ...n, data: n.data ?? {} } });
}
