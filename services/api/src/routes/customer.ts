import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { prisma } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import { cityId, parse, rateLimit } from '../lib/http.js';
import { checkout, CHECKOUT_PAYMENT_METHODS, PAYMENT_METHODS, planCheckout, visibleTo } from '../services/checkout.js';
import { cancelOrderByCustomer } from '../services/fulfillment.js';
import { loadOrder, orderInclude, presentCustomerOrder } from '../services/orderView.js';
import { initiatePayment } from '../services/payments.js';
import { RETURN_REASONS, requestReturn } from '../services/returns.js';
import { CUSTOMER_UPLOAD_PURPOSES, customerUploadPrefix } from '../services/uploads.js';

const addressBody = z.object({
  kind: z.enum(['home', 'workshop']),
  label: z.string().min(1).max(60),
  city: cityId,
  district: z.string().min(2).max(80),
  street: z.string().min(2).max(120),
  details: z.string().max(200).optional(),
  contactName: z.string().min(2).max(80),
  phone: z.string().regex(/^\+?\d{9,15}$/),
  workshopName: z.string().max(80).optional(),
});

const presentAddress = (a: { id: string; kind: string; label: string; city: string; district: string; street: string; details: string | null; contactName: string; phone: string; workshopName: string | null }) => ({
  id: a.id,
  kind: a.kind.toLowerCase(),
  label: a.label,
  city: a.city,
  district: a.district,
  street: a.street,
  details: a.details ?? undefined,
  contactName: a.contactName,
  phone: a.phone,
  workshopName: a.workshopName ?? undefined,
});

const odometerKm = z.number().int().min(0).max(3_000_000);

const presentVehicle = (v: { id: string; modelId: string; year: number; trim: string; engine: string; vin: string | null; odometerKm: number | null; odometerUpdatedAt: Date | null; createdAt: Date }) => ({
  id: v.id,
  modelId: v.modelId,
  year: v.year,
  trim: v.trim || undefined,
  engine: v.engine,
  vin: v.vin ?? undefined,
  odometerKm: v.odometerKm ?? undefined,
  odometerUpdatedAt: v.odometerUpdatedAt?.toISOString(),
  addedAt: v.createdAt.getTime(),
});

export async function customerRoutes(app: FastifyInstance, deps: Deps) {
  const { requireUser } = deps.guards;
  const { ctx } = deps;

  // ── garage
  app.get('/v1/me/vehicles', async (req) => {
    const p = await requireUser(req);
    const rows = await prisma.garageVehicle.findMany({ where: { userId: p.userId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return { vehicles: rows.map(presentVehicle) };
  });

  app.post('/v1/me/vehicles', async (req) => {
    const p = await requireUser(req);
    const body = parse(
      z.object({
        modelId: z.string().max(60),
        year: z.number().int(),
        // Trim is not used by fitment: optional, stored as "" when omitted.
        trim: z.string().max(60).optional(),
        // Optional only when the model has a single engine.
        engine: z.string().min(1).max(60).optional(),
        vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/i).optional(),
        odometerKm: odometerKm.optional(),
      }),
      req.body,
    );
    const model = await prisma.vehicleModel.findUnique({ where: { id: body.modelId } });
    if (!model) throw notFound('Vehicle model');
    if (body.year < model.yearFrom || body.year > model.yearTo) throw badRequest('INVALID_YEAR', `Model years ${model.yearFrom}–${model.yearTo}`);
    const trim = body.trim?.trim() ?? '';
    const engine = body.engine ?? (model.engines.length === 1 ? model.engines[0] : undefined);
    if (!engine) throw badRequest('ENGINE_REQUIRED', 'Choose the engine for this model');
    if ((trim && !model.trims.includes(trim)) || !model.engines.includes(engine)) throw badRequest('INVALID_SPEC', 'Unknown trim or engine for this model');
    const v = await prisma.garageVehicle.create({
      data: {
        userId: p.userId,
        modelId: body.modelId,
        year: body.year,
        trim,
        engine,
        vin: body.vin?.toUpperCase(),
        ...(body.odometerKm != null ? { odometerKm: body.odometerKm, odometerUpdatedAt: new Date() } : {}),
      },
    });
    return presentVehicle(v);
  });

  /** Odometer (and VIN) updates from the garage. */
  app.patch('/v1/me/vehicles/:id', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string().max(64) }), req.params);
    const body = parse(
      z.object({ odometerKm: odometerKm.nullable().optional(), vin: z.string().regex(/^[A-HJ-NPR-Z0-9]{17}$/i).nullable().optional() }).refine((b) => b.odometerKm !== undefined || b.vin !== undefined, 'Nothing to update'),
      req.body,
    );
    const existing = await prisma.garageVehicle.findFirst({ where: { id, userId: p.userId, deletedAt: null } });
    if (!existing) throw notFound('Vehicle');
    const v = await prisma.garageVehicle.update({
      where: { id },
      data: {
        ...(body.odometerKm !== undefined ? { odometerKm: body.odometerKm, odometerUpdatedAt: body.odometerKm === null ? null : new Date() } : {}),
        ...(body.vin !== undefined ? { vin: body.vin?.toUpperCase() ?? null } : {}),
      },
    });
    return presentVehicle(v);
  });

  app.delete('/v1/me/vehicles/:id', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const r = await prisma.garageVehicle.updateMany({ where: { id, userId: p.userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!r.count) throw notFound('Vehicle');
    return { ok: true };
  });

  // ── addresses
  app.get('/v1/me/addresses', async (req) => {
    const p = await requireUser(req);
    const rows = await prisma.address.findMany({ where: { userId: p.userId, deletedAt: null }, orderBy: { createdAt: 'desc' } });
    return { addresses: rows.map(presentAddress) };
  });

  app.post('/v1/me/addresses', async (req) => {
    const p = await requireUser(req);
    const body = parse(addressBody, req.body);
    const a = await prisma.address.create({ data: { ...body, kind: body.kind === 'home' ? 'HOME' : 'WORKSHOP', userId: p.userId } });
    return presentAddress(a);
  });

  /** Addresses are immutable snapshots for past orders: editing creates a new record and retires the old. */
  app.put('/v1/me/addresses/:id', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(addressBody, req.body);
    const old = await prisma.address.findFirst({ where: { id, userId: p.userId, deletedAt: null } });
    if (!old) throw notFound('Address');
    const [, a] = await prisma.$transaction([
      prisma.address.update({ where: { id }, data: { deletedAt: new Date() } }),
      prisma.address.create({ data: { ...body, kind: body.kind === 'home' ? 'HOME' : 'WORKSHOP', userId: p.userId } }),
    ]);
    return presentAddress(a);
  });

  app.delete('/v1/me/addresses/:id', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const r = await prisma.address.updateMany({ where: { id, userId: p.userId, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!r.count) throw notFound('Address');
    return { ok: true };
  });

  // ── cart (server copy so it follows the customer across devices)
  app.get('/v1/me/cart', async (req) => {
    const p = await requireUser(req);
    const cart = await prisma.cart.findUnique({ where: { userId: p.userId }, include: { items: true } });
    return { lines: cart?.items.map((i) => ({ offerId: i.offerId, qty: i.quantity })) ?? [] };
  });

  app.put('/v1/me/cart', async (req) => {
    const p = await requireUser(req);
    const { lines } = parse(z.object({ lines: z.array(z.object({ offerId: z.string(), qty: z.number().int().min(1).max(50) })).max(50) }), req.body);
    const offers = await prisma.offer.findMany({ where: { id: { in: lines.map((l) => l.offerId) }, ...visibleTo(p.userId) }, select: { id: true } });
    const valid = lines.filter((l) => offers.some((o) => o.id === l.offerId));
    await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.upsert({ where: { userId: p.userId }, update: {}, create: { userId: p.userId } });
      await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
      if (valid.length) await tx.cartItem.createMany({ data: valid.map((l) => ({ cartId: cart.id, offerId: l.offerId, quantity: l.qty })) });
    });
    return { lines: valid };
  });

  // ── checkout
  app.post('/v1/checkout/plan', rateLimit(ctx.config.RATE_LIMIT_SCALE, 30, '1 minute'), async (req) => {
    const p = await requireUser(req);
    const body = parse(
      z.object({ addressId: z.string(), lines: z.array(z.object({ offerId: z.string(), quantity: z.number().int().min(1).max(20) })).min(1).max(30) }),
      req.body,
    );
    return planCheckout(ctx, p.userId, body);
  });

  app.post('/v1/checkout', rateLimit(ctx.config.RATE_LIMIT_SCALE, 20, '1 minute'), async (req) => {
    const p = await requireUser(req);
    const body = parse(
      z.object({
        planId: z.string(),
        idempotencyKey: z.string().min(8).max(100),
        paymentMethod: z.enum(CHECKOUT_PAYMENT_METHODS),
        // Workshop mode: buy for an organisation (BUYER/OWNER of an APPROVED org, re-checked server-side).
        buyerOrgId: z.string().min(1).max(64).optional(),
        workOrderRef: z.string().max(60).optional(),
        // Only a reference to the customer's own garage vehicle(s): fit is re-computed server-side and
        // any client-supplied fit/guarantee claim is stripped by the schema.
        vehicle: z
          .object({
            garageVehicleId: z.string().min(1).max(64),
            lines: z.array(z.object({ offerId: z.string().max(64), garageVehicleId: z.string().min(1).max(64) })).max(30).optional(),
          })
          .optional(),
      }),
      req.body,
    );
    return checkout(ctx, p.userId, body);
  });

  // ── orders
  /** Retail (default): the user's personal orders. `?orgId=` (workshop mode): every order of that organisation. */
  app.get('/v1/orders', async (req) => {
    const p = await requireUser(req);
    const { orgId } = parse(z.object({ orgId: z.string().min(1).max(64).optional() }), req.query);
    if (orgId) await deps.guards.requireOrg(req, orgId, 'TECHNICIAN');
    const where = orgId ? { buyerOrgId: orgId } : { customerId: p.userId, buyerOrgId: null };
    const rows = await prisma.order.findMany({ where, include: orderInclude, orderBy: { createdAt: 'desc' }, take: 50 });
    return { orders: rows.map(presentCustomerOrder) };
  });

  app.get('/v1/orders/:id', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    // The buyer, or any active member of the buying organisation.
    const orgIds = p.orgMemberships.map((m) => m.orgId);
    return presentCustomerOrder(await loadOrder(id, orgIds.length ? { OR: [{ customerId: p.userId }, { buyerOrgId: { in: orgIds } }] } : { customerId: p.userId }));
  });

  app.post('/v1/orders/:id/payment', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { method } = parse(z.object({ method: z.enum(PAYMENT_METHODS) }), req.body);
    await loadOrder(id, { customerId: p.userId });
    const payment = await initiatePayment(ctx, id, method);
    return { id: payment.id, redirectUrl: payment.redirectUrl, sandbox: payment.sandbox, status: payment.status};
  });

  app.post('/v1/orders/:id/cancel', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const { reason } = parse(z.object({ reason: z.string().min(2).max(200) }), req.body);
    await cancelOrderByCustomer(ctx, p.userId, id, reason);
    return presentCustomerOrder(await loadOrder(id, { customerId: p.userId }));
  });

  app.post('/v1/orders/:id/returns', async (req) => {
    const p = await requireUser(req);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(
      z.object({
        items: z.array(z.object({ orderItemId: z.string(), quantity: z.number().int().min(1) })).min(1),
        reason: z.enum(RETURN_REASONS),
        note: z.string().max(500).optional(),
        photoKeys: z.array(z.string().max(300)).max(6).optional(),
        unopened: z.boolean().optional(),
      }),
      req.body,
    );
    await requestReturn(ctx, p.userId, id, body);
    return presentCustomerOrder(await loadOrder(id, { customerId: p.userId }));
  });

  // ── private uploads (return and part-request photos), scoped to a hashed per-customer folder.
  app.post('/v1/me/uploads', rateLimit(ctx.config.RATE_LIMIT_SCALE, 30, '10 minutes'), async (req) => {
    const p = await requireUser(req);
    const body = parse(z.object({ purpose: z.enum(CUSTOMER_UPLOAD_PURPOSES), contentType: z.string().max(60), sizeBytes: z.number().int(), fileName: z.string().min(1).max(200) }), req.body);
    if (!['image/jpeg', 'image/png'].includes(body.contentType)) throw badRequest('UNSUPPORTED_TYPE', 'Upload a JPEG or PNG photo');
    return ctx.uploads.createUpload({ prefix: customerUploadPrefix(p.userId, body.purpose).replace(/\/$/, ''), contentType: body.contentType, sizeBytes: body.sizeBytes, fileName: body.fileName });
  });

  app.get('/v1/me/uploads', async (req) => {
    const p = await requireUser(req);
    const { key } = parse(z.object({ key: z.string().max(300) }), req.query);
    if (!CUSTOMER_UPLOAD_PURPOSES.some((purpose) => key.startsWith(customerUploadPrefix(p.userId, purpose)))) throw notFound('File');
    return { url: await ctx.uploads.downloadUrl(key) };
  });

  // ── notifications
  app.get('/v1/me/notifications', async (req) => {
    const p = await requireUser(req);
    const rows = await prisma.notification.findMany({ where: { userId: p.userId, audience: 'CUSTOMER' }, orderBy: { createdAt: 'desc' }, take: 50 });
    return { notifications: rows };
  });

  app.post('/v1/me/notifications/read', async (req) => {
    const p = await requireUser(req);
    await prisma.notification.updateMany({ where: { userId: p.userId, readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });
}
