import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

import type { Ctx } from './context.js';
import { prisma, withTx } from './db.js';
import { notify } from './services/events.js';
import { expireUnpaidOrders, submitPendingRefunds } from './services/payments.js';
import { pendingSandboxRefundWebhooks, type Delivery } from './services/sandboxDelivery.js';

/**
 * Background jobs. Every job is idempotent and safe to run concurrently on several workers
 * (row locks / conditional updates), so ECS can scale the worker service horizontally.
 */

/** Marks merchant orders that missed their accept/ready SLA and alerts ops + merchant once. */
export async function slaMonitor(now = new Date()) {
  const late = await prisma.merchantOrder.findMany({
    where: { slaBreached: false, OR: [{ status: 'NEW', acceptBy: { lt: now } }, { status: { in: ['ACCEPTED', 'PACKING'] }, readyBy: { lt: now } }] },
    take: 200,
  });
  for (const mo of late) {
    await withTx(async (tx) => {
      const r = await tx.merchantOrder.updateMany({ where: { id: mo.id, slaBreached: false }, data: { slaBreached: true } });
      if (!r.count) return;
      const stage = mo.status === 'NEW' ? 'القبول' : 'التجهيز';
      await notify(tx, { audience: 'OPS', type: 'sla.breached', title: 'تجاوز مهلة التاجر', body: `${mo.number}: تأخر ${stage}`, data: { merchantOrderId: mo.id } });
      await notify(tx, { audience: 'MERCHANT', merchantId: mo.merchantId, type: 'sla.breached', title: 'تأخر في الطلب', body: `الطلب ${mo.number} تجاوز مهلة ${stage}`, data: { merchantOrderId: mo.id } });
    });
  }
  return late.length;
}

/** Pickups whose window passed without a carrier scan become exceptions for the control tower. */
export async function pickupDelayMonitor(now = new Date()) {
  const late = await prisma.shipment.findMany({ where: { status: 'PICKUP_SCHEDULED', pickupWindowEnd: { lt: now }, exceptionReason: null }, include: { merchantOrder: true } });
  for (const s of late) {
    await withTx(async (tx) => {
      const r = await tx.shipment.updateMany({ where: { id: s.id, exceptionReason: null }, data: { exceptionReason: 'PICKUP_DELAYED' } });
      if (!r.count) return;
      await notify(tx, { audience: 'OPS', type: 'shipment.pickup_delayed', title: 'تأخر استلام شحنة', body: `${s.merchantOrder.number} — انتهت نافذة الاستلام`, data: { shipmentId: s.id } });
    });
  }
  return late.length;
}

/** Relays outbox events to SQS (when configured) and marks them done. */
export async function relayOutbox(sqs?: { client: SQSClient; queueUrl: string }) {
  const batch = await prisma.$queryRaw<{ id: bigint }[]>`
    UPDATE "DomainEvent" SET "lockedUntil" = now() + interval '30 seconds', attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM "DomainEvent" WHERE status = 'PENDING' AND "availableAt" <= now() AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
      ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED
    ) RETURNING id`;
  for (const { id } of batch) {
    const e = await prisma.domainEvent.findUniqueOrThrow({ where: { id } });
    try {
      if (sqs) {
        await sqs.client.send(
          new SendMessageCommand({
            QueueUrl: sqs.queueUrl,
            MessageBody: JSON.stringify({ id: e.id.toString(), type: e.type, entityType: e.entityType, entityId: e.entityId, orderId: e.orderId, payload: e.payload }),
            ...(sqs.queueUrl.endsWith('.fifo') ? { MessageGroupId: e.orderId ?? e.entityId, MessageDeduplicationId: e.id.toString() } : {}),
          }),
        );
      }
      await prisma.domainEvent.update({ where: { id }, data: { status: 'DONE', lockedUntil: null } });
    } catch (err) {
      const failed = e.attempts >= 10;
      await prisma.domainEvent.update({
        where: { id },
        data: { status: failed ? 'FAILED' : 'PENDING', lastError: String(err).slice(0, 500), availableAt: new Date(Date.now() + 2 ** Math.min(e.attempts, 8) * 1000), lockedUntil: null },
      });
    }
  }
  return batch.length;
}

/** Retention: expired checkout plans/quotes after 1 day, processed outbox events after 30 days. */
export async function purgeExpired(now = new Date()) {
  const day = new Date(now.getTime() - 86_400_000);
  const month = new Date(now.getTime() - 30 * 86_400_000);
  const [plans, quotes, events] = await Promise.all([
    prisma.checkoutPlan.deleteMany({ where: { expiresAt: { lt: day } } }),
    prisma.shippingQuote.deleteMany({ where: { expiresAt: { lt: day } } }),
    prisma.domainEvent.deleteMany({ where: { status: 'DONE', createdAt: { lt: month } } }),
  ]);
  return plans.count + quotes.count + events.count;
}

export async function deliverOverHttp(baseUrl: string, d: Delivery) {
  const res = await fetch(new URL(d.url, baseUrl), { method: 'POST', body: d.body, headers: d.headers });
  return res.status;
}

export async function runAllJobs(ctx: Ctx, opts: { sqs?: { client: SQSClient; queueUrl: string }; deliver?: (d: Delivery) => Promise<unknown> } = {}) {
  const out: Record<string, number> = {};
  out.expired = await expireUnpaidOrders();
  out.sla = await slaMonitor();
  out.pickupDelays = await pickupDelayMonitor();
  out.refundsSubmitted = await submitPendingRefunds(ctx);
  if (ctx.payments.sandbox) {
    const deliveries = await pendingSandboxRefundWebhooks(ctx.config.PAYMENT_WEBHOOK_SECRET);
    for (const d of deliveries) await (opts.deliver ?? ((x: Delivery) => deliverOverHttp(ctx.config.PUBLIC_BASE_URL, x)))(d);
    out.sandboxRefundsSettled = deliveries.length;
  }
  out.outbox = await relayOutbox(opts.sqs);
  out.purged = await purgeExpired();
  return out;
}
