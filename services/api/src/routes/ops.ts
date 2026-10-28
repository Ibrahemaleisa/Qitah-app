import { OrderStatus as OrderStatusEnum, ReturnStatus as ReturnStatusEnum, type MerchantStatus, type OrderStatus, type Prisma, type ReturnStatus, type ShipmentStatus } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { deliverInProcess, type Deps } from '../app.js';
import { hashPassword } from '../auth/crypto.js';
import { prisma, withTx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { pageQuery, parse } from '../lib/http.js';
import { splitRefundByLine } from '../domain/commission.js';
import { priorLineReversals } from '../services/commission.js';
import { audit, emit, notify, type Actor } from '../services/events.js';
import * as finance from '../services/finance.js';
import { createRule, listRules, previewRate, updateRule } from '../services/commission.js';
import { economicsJobs } from '../jobs.js';
import { allScorecards, merchantScorecard } from '../services/scorecard.js';
import { acceptMerchantOrder, markReady, rejectMerchantOrder, startPacking } from '../services/fulfillment.js';
import { orderInclude } from '../services/orderView.js';
import { createRefund, submitPendingRefunds } from '../services/payments.js';
import { decideReturn, inspectReturn, markReturnReceived, returnPhotoUrls } from '../services/returns.js';
import { carrierWebhook, pendingSandboxRefundWebhooks } from '../services/sandboxDelivery.js';
import { createLabel, recordTrackingEvent, schedulePickup } from '../services/shipping.js';

const SHIPMENT_STATUSES = [
  'PENDING', 'LABEL_CREATED', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED',
  'PICKUP_FAILED', 'DELIVERY_FAILED', 'EXCEPTION', 'CANCELLED', 'RETURNED_TO_SENDER',
] as const satisfies readonly ShipmentStatus[];

export async function opsRoutes(app: FastifyInstance, deps: Deps) {
  const { requirePlatform } = deps.guards;
  const { ctx } = deps;
  const ops = async (req: Parameters<typeof requirePlatform>[0], roles?: Parameters<typeof requirePlatform>[1]) => {
    const p = await requirePlatform(req, roles);
    return { p, actor: { userId: p.userId, type: 'ops' } as Actor };
  };
  const idOf = (req: { params: unknown }) => parse(z.object({ id: z.string().max(64) }), req.params).id;

  app.get('/v1/ops/summary', async (req) => {
    await ops(req);
    const now = new Date();
    const [pendingMerchants, approvedMerchants, ordersToday, awaitingAcceptance, readyForPickup, activeShipments, exceptions, openReturns, pendingRefunds, slaBreaches] = await Promise.all([
      prisma.merchant.count({ where: { status: { in: ['APPLIED', 'UNDER_REVIEW'] } } }),
      prisma.merchant.count({ where: { status: 'APPROVED' } }),
      prisma.order.count({ where: { createdAt: { gte: new Date(now.getTime() - 86_400_000) }, status: { notIn: ['PENDING_PAYMENT', 'EXPIRED'] } } }),
      prisma.merchantOrder.count({ where: { status: 'NEW' } }),
      prisma.merchantOrder.count({ where: { status: 'READY_FOR_PICKUP' } }),
      prisma.shipment.count({ where: { status: { notIn: ['DELIVERED', 'CANCELLED', 'RETURNED_TO_SENDER'] } } }),
      prisma.shipment.count({ where: { status: { in: ['PICKUP_FAILED', 'DELIVERY_FAILED', 'EXCEPTION'] } } }),
      prisma.returnCase.count({ where: { status: { in: ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'] } } }),
      prisma.refund.count({ where: { status: 'PENDING' } }),
      prisma.merchantOrder.count({ where: { slaBreached: true, status: { in: ['NEW', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'] } } }),
    ]);
    return { pendingMerchants, approvedMerchants, ordersToday, awaitingAcceptance, readyForPickup, activeShipments, exceptions, openReturns, pendingRefunds, slaBreaches, sandbox: ctx.config.sandbox };
  });

  // ── merchants
  app.get('/v1/ops/merchants', async (req) => {
    await ops(req);
    const q = parse(pageQuery.extend({ status: z.enum(['APPLIED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(), q: z.string().max(100).optional() }), req.query);
    const where: Prisma.MerchantWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ displayNameAr: { contains: q.q } }, { displayNameEn: { contains: q.q, mode: 'insensitive' } }, { crNumber: { contains: q.q } }] } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.merchant.count({ where }),
      prisma.merchant.findMany({ where, include: { _count: { select: { offers: true, locations: true, merchantOrders: true } } }, orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }),
    ]);
    return { total, items };
  });

  // ── merchant economics: performance, commission rules, settlement settings
  app.get('/v1/ops/merchants/performance', async (req) => {
    await ops(req);
    return { items: await allScorecards() };
  });

  app.get('/v1/ops/merchants/:id/scorecard', async (req) => {
    await ops(req);
    const id = idOf(req);
    if (!(await prisma.merchant.findUnique({ where: { id }, select: { id: true } }))) throw notFound('Merchant');
    return merchantScorecard(id);
  });

  /** Negotiated rate (null = use the commission tiers), settlement cadence and early-payout trust. */
  app.patch('/v1/ops/merchants/:id/economics', async (req) => {
    const { actor } = await ops(req, ['OPS_ADMIN', 'FINANCE']);
    const id = idOf(req);
    const body = parse(
      z.object({
        commissionBps: z.number().int().min(0).max(5000).nullable().optional(),
        settlementCadence: z.enum(['WEEKLY', 'DAILY']).optional(),
        trustedForEarlyPayout: z.boolean().optional(),
      }),
      req.body,
    );
    return withTx(async (tx) => {
      const m = await tx.merchant.findUnique({ where: { id } });
      if (!m) throw notFound('Merchant');
      const updated = await tx.merchant.update({ where: { id }, data: body });
      await audit(tx, actor, { action: 'merchant.economics_updated', entityType: 'merchant', entityId: id, merchantId: id, data: { before: { commissionBps: m.commissionBps, settlementCadence: m.settlementCadence, trustedForEarlyPayout: m.trustedForEarlyPayout }, after: body } });
      return updated;
    });
  });

  const ruleBody = z.object({
    name: z.string().min(2).max(120),
    merchantId: z.string().max(64).nullable().optional(),
    categoryId: z.string().max(40).nullable().optional(),
    origin: z.enum(['OEM', 'AFTERMARKET']).nullable().optional(),
    condition: z.enum(['NEW', 'USED', 'REFURBISHED']).nullable().optional(),
    channel: z.enum(['B2C', 'B2B', 'ANY']).default('ANY'),
    bps: z.number().int().min(0).max(5000),
    priority: z.number().int().min(-100).max(100).default(0),
    active: z.boolean().default(true),
    validFrom: z.coerce.date().nullable().optional(),
    validTo: z.coerce.date().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  });

  app.get('/v1/ops/commission-rules', async (req) => {
    await ops(req);
    return { rules: await listRules(), defaultBps: ctx.config.COMMISSION_DEFAULT_BPS };
  });

  app.post('/v1/ops/commission-rules', async (req) => {
    const { actor } = await ops(req, ['OPS_ADMIN', 'FINANCE']);
    return createRule(actor, parse(ruleBody, req.body));
  });

  app.patch('/v1/ops/commission-rules/:id', async (req) => {
    const { actor } = await ops(req, ['OPS_ADMIN', 'FINANCE']);
    const body = parse(ruleBody.partial().extend({ channel: z.enum(['B2C', 'B2B', 'ANY']).optional(), priority: z.number().int().min(-100).max(100).optional(), active: z.boolean().optional() }), req.body);
    return updateRule(actor, idOf(req), body);
  });

  /** "Which rate applies?" for a merchant + category + origin + condition + channel. */
  app.get('/v1/ops/commission-rules/preview', async (req) => {
    await ops(req);
    const q = parse(
      z.object({ merchantId: z.string().max(64), categoryId: z.string().max(40), origin: z.enum(['OEM', 'AFTERMARKET']), condition: z.enum(['NEW', 'USED', 'REFURBISHED']).default('NEW'), channel: z.enum(['B2C', 'B2B']).default('B2C') }),
      req.query,
    );
    return previewRate(ctx.config.COMMISSION_DEFAULT_BPS, q);
  });

  app.get('/v1/ops/uploads', async (req) => {
    await ops(req);
    const { key } = parse(z.object({ key: z.string().max(300).regex(/^merchants\//) }), req.query);
    return { url: await ctx.uploads.downloadUrl(key) };
  });

  app.get('/v1/ops/merchants/:id', async (req) => {
    await ops(req);
    const id = idOf(req);
    const m = await prisma.merchant.findUnique({
      where: { id },
      include: {
        verifications: { orderBy: { createdAt: 'desc' } },
        locations: true,
        members: { include: { user: { select: { id: true, name: true, email: true, phone: true } } } },
        _count: { select: { offers: true, merchantOrders: true } },
      },
    });
    if (!m) throw notFound('Merchant');
    const [orderStats, balance] = await Promise.all([
      prisma.merchantOrder.groupBy({ by: ['status'], where: { merchantId: id }, _count: true }),
      finance.merchantBalance(id),
    ]);
    return { ...m, orderStats, balance };
  });

  const merchantDecision = (path: string, to: MerchantStatus, from: MerchantStatus[], roles: Parameters<typeof requirePlatform>[1]) =>
    app.post(`/v1/ops/merchants/:id/${path}`, async (req) => {
      const { actor } = await ops(req, roles);
      const id = idOf(req);
      const body = parse(z.object({ reason: z.string().max(500).optional(), commissionBps: z.number().int().min(0).max(5000).optional() }), req.body ?? {});
      if ((to === 'REJECTED' || to === 'SUSPENDED') && !body.reason) throw badRequest('REASON_REQUIRED', 'A reason is required');
      return withTx(async (tx) => {
        const m = await tx.merchant.findUnique({ where: { id } });
        if (!m) throw notFound('Merchant');
        if (!from.includes(m.status)) throw conflict('INVALID_TRANSITION', `Merchant is ${m.status}`);
        const updated = await tx.merchant.update({
          where: { id },
          data: {
            status: to,
            statusReason: body.reason ?? null,
            ...(body.commissionBps !== undefined ? { commissionBps: body.commissionBps } : {}),
            ...(to === 'APPROVED' ? { approvedAt: new Date(), approvedById: actor.userId } : {}),
          },
        });
        if (to === 'APPROVED' || to === 'REJECTED') {
          await tx.merchantVerification.updateMany({
            where: { merchantId: id, status: 'PENDING' },
            data: { status: to === 'APPROVED' ? 'APPROVED' : 'REJECTED', reviewedById: actor.userId, reviewedAt: new Date(), reviewNote: body.reason },
          });
        }
        await notify(tx, {
          audience: 'MERCHANT',
          merchantId: id,
          type: `merchant.${to.toLowerCase()}`,
          title: { APPROVED: 'تم اعتماد متجرك', REJECTED: 'لم يتم اعتماد طلبك', SUSPENDED: 'تم إيقاف متجرك مؤقتاً' }[to as 'APPROVED'] ?? 'تحديث حالة المتجر',
          body: body.reason ?? (to === 'APPROVED' ? 'يمكنك الآن نشر عروضك' : ''),
        });
        await audit(tx, actor, { action: `merchant.${to.toLowerCase()}`, entityType: 'merchant', entityId: id, merchantId: id, data: body });
        await emit(tx, { type: 'merchant.updated', entityType: 'merchant', entityId: id, merchantIds: [id], payload: { status: to } });
        return updated;
      });
    });
  merchantDecision('approve', 'APPROVED', ['APPLIED', 'UNDER_REVIEW'], ['OPS_ADMIN']);
  merchantDecision('reject', 'REJECTED', ['APPLIED', 'UNDER_REVIEW'], ['OPS_ADMIN']);
  merchantDecision('suspend', 'SUSPENDED', ['APPROVED'], ['OPS_ADMIN']);
  merchantDecision('reinstate', 'APPROVED', ['SUSPENDED'], ['OPS_ADMIN']);

  // ── orders
  app.get('/v1/ops/orders', async (req) => {
    await ops(req);
    const q = parse(pageQuery.extend({ status: z.string().optional(), q: z.string().max(60).optional() }), req.query);
    const statuses = q.status?.split(',').filter((x): x is OrderStatus => x in OrderStatusEnum);
    const where: Prisma.OrderWhereInput = {
      ...(statuses?.length ? { status: { in: statuses } } : {}),
      ...(q.q ? { OR: [{ number: { contains: q.q.toUpperCase() } }, { customer: { phone: { contains: q.q } } }] } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.findMany({
        where,
        include: { customer: { select: { id: true, name: true, phone: true } }, merchantOrders: { select: { id: true, number: true, status: true, merchant: { select: { displayNameAr: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: q.offset,
      }),
    ]);
    return { total, items };
  });

  /** Full trace of one order across every table — the single place to answer "what happened?". */
  app.get('/v1/ops/orders/:id', async (req) => {
    await ops(req);
    const id = idOf(req);
    const order = await prisma.order.findUnique({
      where: { id },
      include: {
        ...orderInclude,
        customer: { select: { id: true, name: true, phone: true } },
        payments: { include: { events: { orderBy: { createdAt: 'asc' } } }, orderBy: { createdAt: 'asc' } },
        reservations: true,
        ledgerEntries: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!order) throw notFound('Order');
    const entityIds = [order.id, ...order.merchantOrders.map((m) => m.id), ...order.shipments.map((s) => s.id), ...order.returnCases.map((r) => r.id)];
    const auditTrail = await prisma.auditEvent.findMany({ where: { entityId: { in: entityIds } }, orderBy: { createdAt: 'asc' } });
    const reconciliation = await finance.reconcileOrder(id);
    return { order, auditTrail, reconciliation };
  });

  app.get('/v1/ops/orders/:id/reconcile', async (req) => {
    await ops(req, ['FINANCE', 'OPS_AGENT']);
    return finance.reconcileOrder(idOf(req));
  });

  /** Goodwill / partial refund against one merchant suborder (merchant-funded share is item value). */
  app.post('/v1/ops/orders/:id/refunds', async (req) => {
    const { actor } = await ops(req, ['FINANCE']);
    const id = idOf(req);
    const body = parse(z.object({ merchantOrderId: z.string(), amountHalalas: z.number().int().positive(), reason: z.string().min(3).max(300), idempotencyKey: z.string().min(8).max(100) }), req.body);
    await withTx(async (tx) => {
      const mo = await tx.merchantOrder.findFirst({ where: { id: body.merchantOrderId, orderId: id }, include: { items: true } });
      if (!mo) throw notFound('Merchant order');
      const payment = await tx.payment.findFirst({ where: { orderId: id, status: { in: ['CAPTURED', 'PARTIALLY_REFUNDED'] } } });
      if (!payment) throw conflict('NOT_REFUNDABLE', 'No captured payment');
      const alreadyRefunded = await tx.refund.findMany({ where: { orderId: id, status: { in: ['PENDING', 'SUCCEEDED'] } } });
      const moRefunded = alreadyRefunded.flatMap((r) => r.allocation as { merchantOrderId: string; items: number }[]).filter((a) => a.merchantOrderId === mo.id).reduce((s, a) => s + a.items, 0);
      if (body.amountHalalas > mo.itemsHalalas - moRefunded) throw conflict('REFUND_EXCEEDS_ITEMS', `At most ${mo.itemsHalalas - moRefunded} halalas refundable for this suborder`);
      // Goodwill is spread over the suborder's active lines by value; each share reverses commission at its line's rate.
      const split = splitRefundByLine(
        mo.items.filter((i) => i.status === 'ACTIVE').map((i) => ({ orderItemId: i.id, valueHalalas: i.lineTotalHalalas, commissionBps: i.commissionBps, commissionHalalas: i.commissionHalalas })),
        body.amountHalalas,
        await priorLineReversals(tx, id),
      );
      await createRefund(tx, {
        payment,
        amountHalalas: body.amountHalalas,
        reason: `OPS:${body.reason}`,
        allocation: [{ merchantId: mo.merchantId, merchantOrderId: mo.id, items: body.amountHalalas, shipping: 0, ...split }],
        idempotencyKey: `ops:${body.idempotencyKey}`,
        actor,
      });
    });
    await submitPendingRefunds(ctx, id);
    return prisma.refund.findMany({ where: { orderId: id }, orderBy: { createdAt: 'asc' } });
  });

  // ── fulfilment queue & SLA
  app.get('/v1/ops/fulfillment/queue', async (req) => {
    await ops(req);
    const rows = await prisma.merchantOrder.findMany({
      where: { status: { in: ['NEW', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'] } },
      include: {
        merchant: { select: { id: true, displayNameAr: true, city: true } },
        order: { select: { id: true, number: true, addressSnapshot: true } },
        groups: { include: { originLocation: { select: { name: true, city: true } } } },
        shipments: { where: { direction: 'OUTBOUND', status: { not: 'CANCELLED' } } },
        items: { select: { productNameAr: true, quantity: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    const now = Date.now();
    return {
      items: rows.map((m) => {
        const due = m.status === 'NEW' ? m.acceptBy : m.readyBy;
        return { ...m, slaDueAt: due, slaMinutesLeft: due ? Math.round((due.getTime() - now) / 60_000) : null };
      }),
    };
  });

  // Ops can act on a merchant order on the merchant's behalf (e.g. phone confirmation). Always audited as ops.
  for (const [name, fn] of [
    ['accept', (a: Actor, id: string) => acceptMerchantOrder(ctx, a, id)],
    ['pack', (a: Actor, id: string) => startPacking(ctx, a, id)],
    ['ready', (a: Actor, id: string) => markReady(ctx, a, id)],
  ] as const) {
    app.post(`/v1/ops/merchant-orders/:id/${name}`, async (req) => {
      const { actor } = await ops(req, ['OPS_AGENT']);
      return fn(actor, idOf(req));
    });
  }
  app.post('/v1/ops/merchant-orders/:id/reject', async (req) => {
    const { actor } = await ops(req, ['OPS_AGENT']);
    const { reason } = parse(z.object({ reason: z.string().min(2).max(200) }), req.body);
    return rejectMerchantOrder(ctx, actor, idOf(req), reason);
  });

  // ── shipments (control tower)
  app.get('/v1/ops/shipments', async (req) => {
    await ops(req);
    const q = parse(pageQuery.extend({ status: z.string().optional(), direction: z.enum(['OUTBOUND', 'RETURN']).optional() }), req.query);
    const statuses = q.status?.split(',').filter((s): s is ShipmentStatus => (SHIPMENT_STATUSES as readonly string[]).includes(s));
    const where: Prisma.ShipmentWhereInput = { ...(statuses?.length ? { status: { in: statuses } } : {}), ...(q.direction ? { direction: q.direction } : {}) };
    const [total, items] = await Promise.all([
      prisma.shipment.count({ where }),
      prisma.shipment.findMany({
        where,
        include: {
          originLocation: { select: { id: true, name: true, city: true, district: true } },
          merchantOrder: { select: { id: true, number: true, status: true, merchant: { select: { id: true, displayNameAr: true } } } },
          order: { select: { id: true, number: true, addressSnapshot: true } },
          events: { orderBy: { occurredAt: 'desc' }, take: 1 },
        },
        orderBy: { updatedAt: 'desc' },
        take: q.limit,
        skip: q.offset,
      }),
    ]);
    return { total, items };
  });

  app.get('/v1/ops/shipments/:id', async (req) => {
    await ops(req);
    const s = await prisma.shipment.findUnique({
      where: { id: idOf(req) },
      include: { events: { orderBy: { occurredAt: 'asc' } }, originLocation: true, merchantOrder: { include: { merchant: true, items: true } }, order: true, group: true, returnCase: true },
    });
    if (!s) throw notFound('Shipment');
    return s;
  });

  app.post('/v1/ops/shipments/:id/label', async (req) => {
    const { actor } = await ops(req, ['OPS_AGENT']);
    return createLabel(ctx, actor, idOf(req));
  });

  app.post('/v1/ops/shipments/:id/pickup', async (req) => {
    const { actor } = await ops(req, ['OPS_AGENT']);
    const body = parse(z.object({ windowStart: z.coerce.date(), windowEnd: z.coerce.date() }), req.body);
    return schedulePickup(ctx, actor, idOf(req), body.windowStart, body.windowEnd);
  });

  /** Manual event from ops (e.g. carrier phone confirmation). Recorded with source OPS. */
  app.post('/v1/ops/shipments/:id/events', async (req) => {
    const { actor } = await ops(req, ['OPS_AGENT']);
    const body = parse(z.object({ status: z.enum(SHIPMENT_STATUSES), description: z.string().min(2).max(300), location: z.string().max(120).optional() }), req.body);
    await recordTrackingEvent({ shipmentId: idOf(req), ...body, source: 'OPS', actor });
    return prisma.shipment.findUniqueOrThrow({ where: { id: idOf(req) }, include: { events: { orderBy: { occurredAt: 'asc' } } } });
  });

  /** SANDBOX ONLY: simulate a carrier scan by sending a signed carrier webhook through the real webhook route. */
  app.post('/v1/ops/shipments/:id/sandbox-event', async (req) => {
    await ops(req, ['OPS_AGENT']);
    if (!ctx.carrier.sandbox) throw forbidden('Only available with the sandbox carrier');
    const body = parse(z.object({ status: z.enum(SHIPMENT_STATUSES), description: z.string().max(300).optional(), location: z.string().max(120).optional() }), req.body);
    const s = await prisma.shipment.findUnique({ where: { id: idOf(req) } });
    if (!s?.trackingNumber) throw conflict('NO_LABEL', 'Create a label first');
    const res = await deliverInProcess(app, carrierWebhook(ctx.config.CARRIER_WEBHOOK_SECRET, { trackingNumber: s.trackingNumber, status: body.status, description: body.description ?? `Sandbox scan: ${body.status}`, location: body.location }));
    if (res.statusCode >= 400) return { delivered: false, response: res.body };
    return { delivered: true, response: res.body, shipment: await prisma.shipment.findUniqueOrThrow({ where: { id: s.id }, include: { events: { orderBy: { occurredAt: 'asc' } } } }) };
  });

  app.get('/v1/ops/exceptions', async (req) => {
    await ops(req);
    const now = new Date();
    const [shipments, delayedPickups, slaBreaches, failedRefunds, flaggedPayments] = await Promise.all([
      prisma.shipment.findMany({ where: { status: { in: ['PICKUP_FAILED', 'DELIVERY_FAILED', 'EXCEPTION'] } }, include: { merchantOrder: { select: { number: true, merchant: { select: { displayNameAr: true } } } }, order: { select: { number: true } } } }),
      prisma.shipment.findMany({ where: { status: 'PICKUP_SCHEDULED', pickupWindowEnd: { lt: now } }, include: { merchantOrder: { select: { number: true, merchant: { select: { displayNameAr: true } } } } } }),
      prisma.merchantOrder.findMany({ where: { slaBreached: true, status: { in: ['NEW', 'ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'] } }, include: { merchant: { select: { displayNameAr: true } } } }),
      prisma.refund.findMany({ where: { status: 'FAILED' }, include: { order: { select: { number: true } } } }),
      prisma.paymentEvent.findMany({ where: { outcome: { startsWith: 'flagged' } }, include: { payment: { select: { orderId: true, order: { select: { number: true } } } } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    ]);
    return { shipments, delayedPickups, slaBreaches, failedRefunds, flaggedPayments };
  });

  // ── returns
  app.get('/v1/ops/returns', async (req) => {
    await ops(req);
    const q = parse(z.object({ status: z.string().optional() }), req.query);
    const statuses = q.status?.split(',').filter((x): x is ReturnStatus => x in ReturnStatusEnum);
    const rows = await prisma.returnCase.findMany({
      where: statuses?.length ? { status: { in: statuses } } : {},
      include: { items: { include: { orderItem: true } }, merchant: { select: { displayNameAr: true } }, order: { select: { number: true } }, shipments: true, refunds: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: await Promise.all(rows.map(async (r) => ({ ...r, photos: await returnPhotoUrls(ctx, r.photoKeys) }))) };
  });
  const returnAction = (name: string, fn: (a: Actor, id: string, body: unknown) => Promise<unknown>) =>
    app.post(`/v1/ops/returns/:id/${name}`, async (req) => {
      const { actor } = await ops(req, ['OPS_AGENT']);
      return fn(actor, idOf(req), req.body ?? {});
    });
  returnAction('approve', (a, id, b) => decideReturn(ctx, a, id, true, parse(z.object({ note: z.string().max(300).optional() }), b).note));
  returnAction('reject', (a, id, b) => decideReturn(ctx, a, id, false, parse(z.object({ note: z.string().min(2).max(300) }), b).note));
  returnAction('receive', (a, id) => markReturnReceived(a, id));
  returnAction('inspect', (a, id, b) =>
    inspectReturn(ctx, a, id, parse(z.object({ accept: z.boolean(), restock: z.boolean().default(false), refundHalalas: z.number().int().positive().optional(), note: z.string().max(300).optional() }), b)),
  );

  // ── finance
  app.get('/v1/ops/settlements', async (req) => {
    await ops(req, ['FINANCE']);
    const settlements = await prisma.settlement.findMany({ include: { merchant: { select: { displayNameAr: true } }, lines: true }, orderBy: { createdAt: 'desc' }, take: 100 });
    const merchants = await prisma.merchant.findMany({ where: { status: { in: ['APPROVED', 'SUSPENDED'] } }, select: { id: true, displayNameAr: true, settlementCadence: true, trustedForEarlyPayout: true } });
    const eligibility = await Promise.all(
      merchants.map(async (m) => {
        const lines = await finance.eligibleMerchantOrders(ctx, m.id);
        return {
          merchantId: m.id,
          displayNameAr: m.displayNameAr,
          settlementCadence: m.settlementCadence,
          trustedForEarlyPayout: m.trustedForEarlyPayout,
          eligibleOrders: lines.length,
          eligibleNetHalalas: lines.reduce((s, l) => s + l.netHalalas, 0),
          eligibleReserveHalalas: lines.filter((l) => l.kind === 'SALE').reduce((s, l) => s + l.reserveHalalas, 0),
          balance: await finance.merchantBalance(m.id),
        };
      }),
    );
    return { settlements, eligibility };
  });

  app.post('/v1/ops/settlements/generate', async (req) => {
    const { actor } = await ops(req, ['FINANCE']);
    const body = parse(z.object({ merchantId: z.string(), asOf: z.coerce.date().optional() }), req.body);
    if (body.asOf && !ctx.config.sandbox) throw forbidden('asOf is only available in sandbox environments');
    return finance.generateSettlement(ctx, actor, body.merchantId, body.asOf);
  });

  /**
   * Runs the automatic settlement jobs now (reserve release → period DRAFTs → stale-offer reminders). Idempotent:
   * a period that already ran is skipped. `asOf` (sandbox only) simulates a later date.
   */
  app.post('/v1/ops/settlements/run', async (req) => {
    await ops(req, ['FINANCE']);
    const body = parse(z.object({ asOf: z.coerce.date().optional() }), req.body ?? {});
    if (body.asOf && !ctx.config.sandbox) throw forbidden('asOf is only available in sandbox environments');
    return economicsJobs(ctx, body.asOf ?? new Date());
  });

  /** Contribution margin per paid order: commission + shipping margin − payment fees − guarantee expense. */
  app.get('/v1/ops/finance/margins', async (req) => {
    await ops(req, ['FINANCE', 'OPS_ADMIN']);
    const q = parse(pageQuery.extend({ from: z.coerce.date().optional(), to: z.coerce.date().optional() }), req.query);
    return finance.orderMargins(q);
  });

  app.post('/v1/ops/settlements/:id/approve', async (req) => {
    const { actor } = await ops(req, ['FINANCE']);
    return finance.approveSettlement(actor, idOf(req));
  });

  app.post('/v1/ops/settlements/:id/paid', async (req) => {
    const { actor } = await ops(req, ['FINANCE']);
    const { payoutReference } = parse(z.object({ payoutReference: z.string().min(3).max(100) }), req.body);
    return finance.markSettlementPaid(actor, idOf(req), payoutReference);
  });

  app.get('/v1/ops/payments/events', async (req) => {
    await ops(req, ['FINANCE', 'OPS_AGENT']);
    return { events: await prisma.paymentEvent.findMany({ orderBy: { createdAt: 'desc' }, take: 100 }) };
  });

  /** SANDBOX ONLY: settle submitted sandbox refunds through signed webhooks (the worker also does this). */
  app.post('/v1/ops/sandbox/refunds/settle', async (req) => {
    await ops(req, ['FINANCE', 'OPS_AGENT']);
    if (!ctx.payments.sandbox) throw forbidden('Only available with the sandbox payment provider');
    await submitPendingRefunds(ctx);
    const deliveries = await pendingSandboxRefundWebhooks(ctx.config.PAYMENT_WEBHOOK_SECRET);
    const results = [];
    for (const d of deliveries) results.push(await deliverInProcess(app, d));
    return { settled: results.length, results };
  });

  // ── audit & staff
  app.get('/v1/ops/audit', async (req) => {
    await ops(req);
    const q = parse(pageQuery.extend({ entityType: z.string().optional(), entityId: z.string().optional(), merchantId: z.string().optional() }), req.query);
    return {
      events: await prisma.auditEvent.findMany({
        where: { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}), ...(q.merchantId ? { merchantId: q.merchantId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: q.limit,
        skip: q.offset,
      }),
    };
  });

  app.get('/v1/ops/notifications', async (req) => {
    await ops(req);
    return { notifications: await prisma.notification.findMany({ where: { audience: 'OPS' }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  });

  app.get('/v1/ops/staff', async (req) => {
    await ops(req, ['OPS_ADMIN']);
    const users = await prisma.user.findMany({
      where: { platformRoles: { some: {} } },
      select: { id: true, name: true, email: true, status: true, createdAt: true, platformRoles: { select: { role: true } } },
      orderBy: { createdAt: 'asc' },
    });
    return { staff: users.map((u) => ({ ...u, roles: u.platformRoles.map((r) => r.role), platformRoles: undefined })) };
  });

  app.post('/v1/ops/staff', async (req) => {
    const { actor } = await ops(req, ['OPS_ADMIN']);
    const body = parse(
      z.object({ name: z.string().min(2).max(80), email: z.string().email().toLowerCase(), roles: z.array(z.enum(['OPS_AGENT', 'OPS_ADMIN', 'FINANCE'])).min(1), password: z.string().min(12).max(200).optional() }),
      req.body,
    );
    if (ctx.config.AUTH_MODE === 'local' && !body.password) throw badRequest('PASSWORD_REQUIRED', 'Set an initial password');
    return withTx(async (tx) => {
      const user = await tx.user.upsert({
        where: { email: body.email },
        update: {},
        create: { email: body.email, name: body.name, passwordHash: body.password ? await hashPassword(body.password) : null },
      });
      for (const role of body.roles) await tx.platformRoleAssignment.upsert({ where: { userId_role: { userId: user.id, role } }, update: {}, create: { userId: user.id, role } });
      await audit(tx, actor, { action: 'ops_staff.granted', entityType: 'user', entityId: user.id, data: { roles: body.roles } });
      return { id: user.id, email: user.email, roles: body.roles };
    });
  });
}
