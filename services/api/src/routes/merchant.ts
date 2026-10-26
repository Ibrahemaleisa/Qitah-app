import { MerchantOrderStatus as MerchantOrderStatusEnum, type MerchantOrderStatus, type Prisma } from '@prisma/client';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { hashPassword } from '../auth/crypto.js';
import { prisma, withTx } from '../db.js';
import { badRequest, conflict, forbidden, notFound, unauthorized } from '../lib/errors.js';
import { cityId, pageQuery, parse, rateLimit, saudiPhone } from '../lib/http.js';
import { normalizePartNumber, normalizeText } from '../lib/text.js';
import { refreshSearchText } from '../services/catalog.js';
import { audit, emit, type Actor } from '../services/events.js';
import * as finance from '../services/finance.js';
import { acceptMerchantOrder, markReady, rejectMerchantOrder, startPacking } from '../services/fulfillment.js';
import { setOnHand } from '../services/inventory.js';
import { decideReturn, inspectReturn, markReturnReceived } from '../services/returns.js';
import { issueSession } from './auth.js';

const productBody = z.object({
  nameAr: z.string().min(2).max(160),
  nameEn: z.string().min(2).max(160),
  descriptionAr: z.string().max(2000).default(''),
  descriptionEn: z.string().max(2000).default(''),
  categoryId: z.string().max(40),
  brand: z.string().min(1).max(80),
  origin: z.enum(['OEM', 'AFTERMARKET']),
  partNumber: z.string().min(2).max(60),
  oemReferences: z.array(z.string().min(2).max(60)).max(30).default([]),
  keywords: z.array(z.string().max(40)).max(30).default([]),
  weightGrams: z.number().int().positive().max(500_000),
  lengthCm: z.number().int().positive().max(500),
  widthCm: z.number().int().positive().max(500),
  heightCm: z.number().int().positive().max(500),
  handling: z.enum(['STANDARD', 'FRAGILE', 'OVERSIZED', 'HAZMAT']).default('STANDARD'),
  fitment: z
    .array(z.object({ modelId: z.string(), yearFrom: z.number().int(), yearTo: z.number().int(), engines: z.array(z.string()).default([]) }))
    .max(200)
    .default([]),
});

const offerBody = z.object({
  productId: z.string(),
  locationId: z.string(),
  sku: z.string().min(1).max(60),
  condition: z.enum(['NEW', 'USED', 'REFURBISHED']).default('NEW'),
  priceHalalas: z.number().int().positive().max(100_000_000),
  compareAtHalalas: z.number().int().positive().max(100_000_000).nullable().optional(),
  warrantyMonths: z.number().int().min(0).max(120).default(0),
  dispatchDaysMin: z.number().int().min(0).max(30).default(0),
  dispatchDaysMax: z.number().int().min(0).max(30).default(1),
  noteAr: z.string().max(300).optional(),
  noteEn: z.string().max(300).optional(),
  stock: z.number().int().min(0).max(100_000).default(0),
});

const locationBody = z.object({
  name: z.string().min(2).max(80),
  city: cityId,
  district: z.string().min(2).max(80),
  street: z.string().min(2).max(160),
  contactPhone: saudiPhone,
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

/** "123.45" → 12345 without floating point. */
export function parseSarToHalalas(value: string): number {
  const m = /^\s*(\d{1,7})(?:\.(\d{1,2}))?\s*$/.exec(value);
  if (!m) throw new Error(`Invalid SAR amount "${value}"`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export async function merchantRoutes(app: FastifyInstance, deps: Deps) {
  const { requireMerchant, principal } = deps.guards;
  const { ctx } = deps;
  const actorOf = (userId: string): Actor => ({ userId, type: 'merchant' });
  const mid = (req: FastifyRequest) => parse(z.object({ merchantId: z.string().max(64) }), req.params).merchantId;

  async function requireApproved(merchantId: string) {
    const m = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    if (m.status !== 'APPROVED') throw forbidden('Your store must be approved by Qitah before publishing offers');
    return m;
  }

  // ── onboarding (public)
  app.post('/v1/merchant-applications', rateLimit(ctx.config.RATE_LIMIT_SCALE, 5, '10 minutes'), async (req) => {
    const body = parse(
      z.object({
        business: z.object({
          legalName: z.string().min(2).max(160),
          displayNameAr: z.string().min(2).max(80),
          displayNameEn: z.string().min(2).max(80),
          crNumber: z.string().regex(/^\d{10}$/, '10-digit commercial registration number'),
          vatNumber: z.string().regex(/^3\d{13}3$/, '15-digit VAT number').optional(),
          city: cityId,
          contactPhone: saudiPhone,
          contactEmail: z.string().email().toLowerCase(),
          specialtyAr: z.string().max(120).default(''),
          specialtyEn: z.string().max(120).default(''),
        }),
        owner: z.object({ name: z.string().min(2).max(80), email: z.string().email().toLowerCase(), password: z.string().min(10).max(200).optional() }),
        location: locationBody,
      }),
      req.body,
    );
    const existingPrincipal = await principal(req);
    if (ctx.config.AUTH_MODE === 'local' && !existingPrincipal && !body.owner.password) throw badRequest('PASSWORD_REQUIRED', 'Choose a password');
    if (ctx.config.AUTH_MODE === 'cognito' && !existingPrincipal) throw unauthorized('Sign in with your Qitah merchant account first');

    const result = await withTx(async (tx) => {
      let userId = existingPrincipal?.userId;
      if (!userId) {
        const clash = await tx.user.findUnique({ where: { email: body.owner.email } });
        if (clash) throw conflict('EMAIL_IN_USE', 'An account with this email already exists; sign in to apply');
        const user = await tx.user.create({ data: { email: body.owner.email, name: body.owner.name, passwordHash: await hashPassword(body.owner.password!) } });
        userId = user.id;
      }
      const merchant = await tx.merchant.create({
        data: {
          ...body.business,
          status: 'UNDER_REVIEW',
          members: { create: { userId, role: 'OWNER' } },
          locations: { create: body.location },
          verifications: { create: { status: 'PENDING', documents: [{ type: 'CR', reference: body.business.crNumber }, ...(body.business.vatNumber ? [{ type: 'VAT', reference: body.business.vatNumber }] : [])] } },
        },
      });
      await audit(tx, actorOf(userId), { action: 'merchant.applied', entityType: 'merchant', entityId: merchant.id, merchantId: merchant.id });
      await tx.notification.create({ data: { audience: 'OPS', type: 'merchant.applied', title: 'طلب انضمام تاجر', body: merchant.displayNameAr, data: { merchantId: merchant.id } } });
      await emit(tx, { type: 'merchant.applied', entityType: 'merchant', entityId: merchant.id, merchantIds: [merchant.id] });
      return { merchant, userId };
    });
    const session = existingPrincipal || ctx.config.AUTH_MODE !== 'local' ? null : await issueSession(deps, result.userId, req.headers['user-agent']);
    return { merchantId: result.merchant.id, status: result.merchant.status, ...(session ? { session } : {}) };
  });

  // ── profile
  app.get('/v1/merchants/:merchantId', async (req) => {
    const merchantId = mid(req);
    const { role } = await requireMerchant(req, merchantId);
    const m = await prisma.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      include: { verifications: { orderBy: { createdAt: 'desc' }, take: 5 }, locations: { orderBy: { createdAt: 'asc' } } },
    });
    return { ...m, myRole: role };
  });

  app.patch('/v1/merchants/:merchantId', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'MANAGER');
    const body = parse(
      z.object({
        displayNameAr: z.string().min(2).max(80).optional(),
        displayNameEn: z.string().min(2).max(80).optional(),
        specialtyAr: z.string().max(120).optional(),
        specialtyEn: z.string().max(120).optional(),
        contactPhone: saudiPhone.optional(),
        contactEmail: z.string().email().optional(),
        supportsWorkshopDelivery: z.boolean().optional(),
        slaAcceptMinutes: z.number().int().min(30).max(1440).optional(),
        slaReadyMinutes: z.number().int().min(60).max(4320).optional(),
      }),
      req.body,
    );
    const m = await prisma.merchant.update({ where: { id: merchantId }, data: body });
    await audit(prisma, actorOf(p.userId), { action: 'merchant.profile_updated', entityType: 'merchant', entityId: merchantId, merchantId, data: body });
    return m;
  });

  app.post('/v1/merchants/:merchantId/verification', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'OWNER');
    const body = parse(
      z.object({
        documents: z.array(z.object({ type: z.enum(['CR', 'VAT', 'IBAN', 'NATIONAL_ADDRESS', 'OTHER']), reference: z.string().min(2).max(120), fileKey: z.string().max(300).optional() })).min(1).max(10),
        notes: z.string().max(1000).optional(),
      }),
      req.body,
    );
    const m = await prisma.merchant.findUniqueOrThrow({ where: { id: merchantId } });
    if (m.status === 'SUSPENDED') throw forbidden('Store is suspended; contact Qitah');
    const v = await prisma.$transaction(async (tx) => {
      const created = await tx.merchantVerification.create({ data: { merchantId, documents: body.documents, notes: body.notes } });
      if (m.status === 'APPLIED' || m.status === 'REJECTED') await tx.merchant.update({ where: { id: merchantId }, data: { status: 'UNDER_REVIEW' } });
      await audit(tx, actorOf(p.userId), { action: 'merchant.verification_submitted', entityType: 'merchant', entityId: merchantId, merchantId });
      return created;
    });
    return v;
  });

  app.get('/v1/merchants/:merchantId/dashboard', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    const counts = await prisma.merchantOrder.groupBy({ by: ['status'], where: { merchantId }, _count: true });
    const c = (s: MerchantOrderStatus) => counts.find((x) => x.status === s)?._count ?? 0;
    const lowStock = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint AS n FROM "Offer" o JOIN "InventoryLevel" i ON i."offerId" = o.id
      WHERE o."merchantId" = ${merchantId} AND o.status = 'ACTIVE' AND i."onHand" - i."reserved" <= 2`;
    const delivered = await prisma.merchantOrder.count({ where: { merchantId, status: 'DELIVERED' } });
    const breached = await prisma.merchantOrder.count({ where: { merchantId, slaBreached: true } });
    const decided = await prisma.merchantOrder.count({ where: { merchantId, status: { in: ['ACCEPTED', 'PACKING', 'READY_FOR_PICKUP', 'HANDED_OVER', 'DELIVERED', 'REJECTED'] } } });
    const rejected = c('REJECTED');
    return {
      queue: { new: c('NEW'), accepted: c('ACCEPTED'), packing: c('PACKING'), readyForPickup: c('READY_FOR_PICKUP'), handedOver: c('HANDED_OVER') },
      openReturns: await prisma.returnCase.count({ where: { merchantId, status: { in: ['REQUESTED', 'APPROVED', 'IN_TRANSIT', 'RECEIVED'] } } }),
      lowStockOffers: Number(lowStock[0]?.n ?? 0),
      activeOffers: await prisma.offer.count({ where: { merchantId, status: 'ACTIVE' } }),
      performance: {
        deliveredOrders: delivered,
        slaBreaches: breached,
        rejectionRate: decided ? rejected / decided : null,
      },
      balance: await finance.merchantBalance(merchantId),
    };
  });

  // ── locations
  app.get('/v1/merchants/:merchantId/locations', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    return { locations: await prisma.pickupLocation.findMany({ where: { merchantId }, orderBy: { createdAt: 'asc' } }) };
  });

  app.post('/v1/merchants/:merchantId/locations', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'MANAGER');
    const body = parse(locationBody, req.body);
    const loc = await prisma.pickupLocation.create({ data: { ...body, merchantId } });
    await audit(prisma, actorOf(p.userId), { action: 'location.created', entityType: 'location', entityId: loc.id, merchantId });
    return loc;
  });

  app.patch('/v1/merchants/:merchantId/locations/:id', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'MANAGER');
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(locationBody.partial().extend({ active: z.boolean().optional() }), req.body);
    const r = await prisma.pickupLocation.updateMany({ where: { id, merchantId }, data: body });
    if (!r.count) throw notFound('Location');
    await audit(prisma, actorOf(p.userId), { action: 'location.updated', entityType: 'location', entityId: id, merchantId, data: body });
    return prisma.pickupLocation.findUniqueOrThrow({ where: { id } });
  });

  // ── staff
  app.get('/v1/merchants/:merchantId/staff', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId, 'MANAGER');
    const members = await prisma.merchantMember.findMany({ where: { merchantId }, include: { user: { select: { id: true, name: true, email: true, phone: true } } }, orderBy: { createdAt: 'asc' } });
    return { staff: members };
  });

  app.post('/v1/merchants/:merchantId/staff', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'OWNER');
    const body = parse(
      z.object({ name: z.string().min(2).max(80), email: z.string().email().toLowerCase(), role: z.enum(['MANAGER', 'STAFF']), password: z.string().min(10).max(200).optional() }),
      req.body,
    );
    if (ctx.config.AUTH_MODE === 'local' && !body.password) throw badRequest('PASSWORD_REQUIRED', 'Set an initial password for the staff member');
    return withTx(async (tx) => {
      let user = await tx.user.findUnique({ where: { email: body.email } });
      if (!user) user = await tx.user.create({ data: { email: body.email, name: body.name, passwordHash: body.password ? await hashPassword(body.password) : null } });
      const member = await tx.merchantMember.create({ data: { merchantId, userId: user.id, role: body.role } });
      await audit(tx, actorOf(p.userId), { action: 'staff.added', entityType: 'merchant_member', entityId: member.id, merchantId, data: { email: body.email, role: body.role } });
      return member;
    });
  });

  app.patch('/v1/merchants/:merchantId/staff/:id', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'OWNER');
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ role: z.enum(['OWNER', 'MANAGER', 'STAFF']).optional(), status: z.enum(['ACTIVE', 'DISABLED']).optional() }), req.body);
    return withTx(async (tx) => {
      const member = await tx.merchantMember.findFirst({ where: { id, merchantId } });
      if (!member) throw notFound('Staff member');
      const demotingOwner = member.role === 'OWNER' && (body.role && body.role !== 'OWNER' || body.status === 'DISABLED');
      if (demotingOwner) {
        const owners = await tx.merchantMember.count({ where: { merchantId, role: 'OWNER', status: 'ACTIVE' } });
        if (owners <= 1) throw conflict('LAST_OWNER', 'A store must keep at least one active owner');
      }
      const updated = await tx.merchantMember.update({ where: { id }, data: body });
      await audit(tx, actorOf(p.userId), { action: 'staff.updated', entityType: 'merchant_member', entityId: id, merchantId, data: body });
      return updated;
    });
  });

  // ── catalog
  app.get('/v1/merchants/:merchantId/catalog/products', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    const q = parse(pageQuery.extend({ q: z.string().max(100).optional(), categoryId: z.string().optional() }), req.query);
    const term = q.q?.trim();
    const where: Prisma.ProductWhereInput = {
      status: { not: 'ARCHIVED' },
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(term
        ? { OR: [{ searchText: { contains: normalizeText(term) } }, { identifiers: { some: { normalized: { contains: normalizePartNumber(term) } } } }] }
        : {}),
    };
    const [total, items] = await Promise.all([
      prisma.product.count({ where }),
      prisma.product.findMany({ where, include: { identifiers: true, fitments: true, category: true }, orderBy: { nameEn: 'asc' }, take: q.limit, skip: q.offset }),
    ]);
    return { total, items };
  });

  app.post('/v1/merchants/:merchantId/catalog/products', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'MANAGER');
    const body = parse(productBody, req.body);
    return createProduct(merchantId, actorOf(p.userId), body);
  });

  async function createProduct(merchantId: string, actor: Actor, body: z.infer<typeof productBody>) {
    const category = await prisma.category.findUnique({ where: { id: body.categoryId } });
    if (!category) throw badRequest('INVALID_CATEGORY', 'Unknown category');
    const models = await prisma.vehicleModel.findMany({ where: { id: { in: body.fitment.map((f) => f.modelId) } } });
    for (const f of body.fitment) {
      const m = models.find((x) => x.id === f.modelId);
      if (!m) throw badRequest('INVALID_FITMENT', `Unknown vehicle model ${f.modelId}`);
      if (f.yearFrom > f.yearTo || f.yearFrom < m.yearFrom || f.yearTo > m.yearTo) throw badRequest('INVALID_FITMENT', `Years outside ${m.nameEn} production range`);
    }
    const normalized = normalizePartNumber(body.partNumber);
    const dup = await prisma.productIdentifier.findFirst({ where: { normalized, type: 'MPN', product: { brand: body.brand } } });
    if (dup) throw conflict('PRODUCT_EXISTS', 'This brand and part number already exist in the catalog; add an offer to it instead', { productId: dup.productId });
    return withTx(async (tx) => {
      const product = await tx.product.create({
        data: {
          nameAr: body.nameAr,
          nameEn: body.nameEn,
          descriptionAr: body.descriptionAr,
          descriptionEn: body.descriptionEn,
          categoryId: body.categoryId,
          brand: body.brand,
          origin: body.origin,
          partNumber: body.partNumber,
          keywords: body.keywords,
          weightGrams: body.weightGrams,
          lengthCm: body.lengthCm,
          widthCm: body.widthCm,
          heightCm: body.heightCm,
          handling: body.handling,
          art: category.art,
          createdByMerchantId: merchantId,
          identifiers: {
            create: [
              { type: 'MPN', value: body.partNumber, normalized, brand: body.brand },
              ...[...new Set(body.oemReferences)].map((v) => ({ type: 'OEM' as const, value: v, normalized: normalizePartNumber(v) })),
            ],
          },
          // Merchant-supplied fitment is always SELLER-sourced (shown as unverified) until Qitah verifies it.
          fitments: { create: body.fitment.map((f) => ({ ...f, source: 'SELLER' as const, createdByMerchantId: merchantId })) },
        },
      });
      await refreshSearchText(tx, product.id);
      await audit(tx, actor, { action: 'product.created', entityType: 'product', entityId: product.id, merchantId });
      return tx.product.findUniqueOrThrow({ where: { id: product.id }, include: { identifiers: true, fitments: true } });
    });
  }

  // ── offers & stock
  app.get('/v1/merchants/:merchantId/offers', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    const q = parse(pageQuery.extend({ status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional(), q: z.string().max(100).optional() }), req.query);
    const where: Prisma.OfferWhereInput = {
      merchantId,
      ...(q.status ? { status: q.status } : { status: { not: 'ARCHIVED' } }),
      ...(q.q ? { OR: [{ sku: { contains: q.q, mode: 'insensitive' } }, { product: { searchText: { contains: normalizeText(q.q) } } }] } : {}),
    };
    const [total, items] = await Promise.all([
      prisma.offer.count({ where }),
      prisma.offer.findMany({ where, include: { product: { select: { id: true, nameAr: true, nameEn: true, partNumber: true, brand: true, categoryId: true } }, inventory: true, location: { select: { id: true, name: true, city: true } } }, orderBy: { updatedAt: 'desc' }, take: q.limit, skip: q.offset }),
    ]);
    return { total, items };
  });

  app.post('/v1/merchants/:merchantId/offers', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'MANAGER');
    await requireApproved(merchantId);
    const body = parse(offerBody, req.body);
    if (body.dispatchDaysMax < body.dispatchDaysMin) throw badRequest('INVALID_DISPATCH', 'Max dispatch days must be ≥ min');
    const loc = await prisma.pickupLocation.findFirst({ where: { id: body.locationId, merchantId, active: true } });
    if (!loc) throw badRequest('INVALID_LOCATION', 'Choose one of your active pickup locations');
    const product = await prisma.product.findFirst({ where: { id: body.productId, status: 'ACTIVE' } });
    if (!product) throw badRequest('INVALID_PRODUCT', 'Unknown product');
    const { stock, ...data } = body;
    return withTx(async (tx) => {
      const offer = await tx.offer.create({ data: { ...data, merchantId, inventory: { create: { onHand: stock } } } });
      if (stock) await tx.inventoryAdjustment.create({ data: { offerId: offer.id, delta: stock, onHandAfter: stock, reason: 'INITIAL', actorUserId: p.userId } });
      await audit(tx, actorOf(p.userId), { action: 'offer.created', entityType: 'offer', entityId: offer.id, merchantId, data: { priceHalalas: body.priceHalalas, stock } });
      await emit(tx, { type: 'offer.updated', entityType: 'offer', entityId: offer.id, merchantIds: [merchantId] });
      return tx.offer.findUniqueOrThrow({ where: { id: offer.id }, include: { inventory: true } });
    });
  });

  app.patch('/v1/merchants/:merchantId/offers/:id', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'MANAGER');
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(
      offerBody.omit({ productId: true, sku: true, stock: true }).partial().extend({ status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional() }),
      req.body,
    );
    const existing = await prisma.offer.findFirst({ where: { id, merchantId } });
    if (!existing) throw notFound('Offer');
    if (body.status === 'ACTIVE') await requireApproved(merchantId);
    if (body.locationId && !(await prisma.pickupLocation.findFirst({ where: { id: body.locationId, merchantId, active: true } }))) {
      throw badRequest('INVALID_LOCATION', 'Choose one of your active pickup locations');
    }
    return withTx(async (tx) => {
      const offer = await tx.offer.update({ where: { id }, data: body, include: { inventory: true } });
      await audit(tx, actorOf(p.userId), { action: 'offer.updated', entityType: 'offer', entityId: id, merchantId, data: { before: { priceHalalas: existing.priceHalalas, status: existing.status }, after: body } });
      await emit(tx, { type: 'offer.updated', entityType: 'offer', entityId: id, merchantIds: [merchantId] });
      return offer;
    });
  });

  app.put('/v1/merchants/:merchantId/offers/:id/stock', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'STAFF');
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const body = parse(z.object({ onHand: z.number().int().min(0).max(100_000), reason: z.enum(['RESTOCK', 'CORRECTION', 'DAMAGE']), note: z.string().max(300).optional() }), req.body);
    const offer = await prisma.offer.findFirst({ where: { id, merchantId } });
    if (!offer) throw notFound('Offer');
    return withTx(async (tx) => {
      const r = await setOnHand(tx, { offerId: id, onHand: body.onHand, reason: body.reason, note: body.note, actor: actorOf(p.userId) });
      await audit(tx, actorOf(p.userId), { action: 'inventory.adjusted', entityType: 'offer', entityId: id, merchantId, data: body });
      await emit(tx, { type: 'offer.updated', entityType: 'offer', entityId: id, merchantIds: [merchantId], payload: { available: r.onHand - r.reserved } });
      return { offerId: id, onHand: r.onHand, reserved: r.reserved, available: r.onHand - r.reserved };
    });
  });

  app.get('/v1/merchants/:merchantId/offers/:id/adjustments', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const offer = await prisma.offer.findFirst({ where: { id, merchantId } });
    if (!offer) throw notFound('Offer');
    return { adjustments: await prisma.inventoryAdjustment.findMany({ where: { offerId: id }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  });

  /**
   * Bulk import (CSV). Columns: sku,partNumber,brand,condition,priceSar,stock[,locationId][,nameAr,nameEn,categoryId,origin,weightGrams,lengthCm,widthCm,heightCm]
   * Rows match an existing product by brand + part number; unknown products are created when the product columns are present.
   */
  app.post('/v1/merchants/:merchantId/offers/import', async (req) => {
    const merchantId = mid(req);
    const { principal: p } = await requireMerchant(req, merchantId, 'MANAGER');
    await requireApproved(merchantId);
    const { csv, dryRun } = parse(z.object({ csv: z.string().min(1).max(1_000_000), dryRun: z.boolean().default(false) }), req.body);
    const rows = parseCsv(csv);
    if (rows.length < 2) throw badRequest('EMPTY_IMPORT', 'CSV needs a header row and at least one data row');
    const header = rows[0].map((h) => h.trim());
    for (const col of ['sku', 'partNumber', 'brand', 'condition', 'priceSar', 'stock']) if (!header.includes(col)) throw badRequest('MISSING_COLUMN', `Missing column "${col}"`);
    if (rows.length > 1001) throw badRequest('TOO_MANY_ROWS', 'Import at most 1000 rows at a time');
    const locations = await prisma.pickupLocation.findMany({ where: { merchantId, active: true } });
    const results: { row: number; sku: string; status: 'created' | 'updated' | 'error'; message?: string }[] = [];
    for (const [i, raw] of rows.slice(1).entries()) {
      const r = Object.fromEntries(header.map((h, k) => [h, (raw[k] ?? '').trim()]));
      const rowNo = i + 2;
      try {
        const price = parseSarToHalalas(r.priceSar);
        const stock = Number(r.stock);
        if (!Number.isInteger(stock) || stock < 0) throw new Error('stock must be a whole number ≥ 0');
        const condition = r.condition.toUpperCase();
        if (!['NEW', 'USED', 'REFURBISHED'].includes(condition)) throw new Error('condition must be NEW, USED or REFURBISHED');
        const location = r.locationId ? locations.find((l) => l.id === r.locationId) : locations[0];
        if (!location) throw new Error('unknown or inactive locationId');
        const normalized = normalizePartNumber(r.partNumber);
        let product = await prisma.product.findFirst({ where: { status: 'ACTIVE', brand: { equals: r.brand, mode: 'insensitive' }, identifiers: { some: { normalized } } } });
        if (!product) {
          if (!r.nameAr || !r.categoryId) throw new Error('product not found; include nameAr,nameEn,categoryId,origin,weightGrams,lengthCm,widthCm,heightCm to create it');
          if (dryRun) {
            results.push({ row: rowNo, sku: r.sku, status: 'created', message: 'new product' });
            continue;
          }
          product = await createProduct(merchantId, actorOf(p.userId), productBody.parse({
            nameAr: r.nameAr,
            nameEn: r.nameEn || r.nameAr,
            categoryId: r.categoryId,
            brand: r.brand,
            origin: (r.origin || 'AFTERMARKET').toUpperCase(),
            partNumber: r.partNumber,
            weightGrams: Number(r.weightGrams),
            lengthCm: Number(r.lengthCm),
            widthCm: Number(r.widthCm),
            heightCm: Number(r.heightCm),
          }));
        }
        const existing = await prisma.offer.findUnique({ where: { merchantId_sku: { merchantId, sku: r.sku } } });
        if (dryRun) {
          results.push({ row: rowNo, sku: r.sku, status: existing ? 'updated' : 'created' });
          continue;
        }
        await withTx(async (tx) => {
          if (existing) {
            if (existing.productId !== product!.id) throw new Error('SKU already used for a different product');
            await tx.offer.update({ where: { id: existing.id }, data: { priceHalalas: price, condition: condition as 'NEW', locationId: location.id } });
            await setOnHand(tx, { offerId: existing.id, onHand: stock, reason: 'CORRECTION', note: 'CSV import', actor: actorOf(p.userId) });
          } else {
            const o = await tx.offer.create({ data: { merchantId, productId: product!.id, locationId: location.id, sku: r.sku, condition: condition as 'NEW', priceHalalas: price, inventory: { create: { onHand: stock } } } });
            if (stock) await tx.inventoryAdjustment.create({ data: { offerId: o.id, delta: stock, onHandAfter: stock, reason: 'IMPORT', actorUserId: p.userId } });
          }
        });
        results.push({ row: rowNo, sku: r.sku, status: existing ? 'updated' : 'created' });
      } catch (e) {
        results.push({ row: rowNo, sku: r.sku ?? '', status: 'error', message: e instanceof Error ? e.message : String(e) });
      }
    }
    if (!dryRun) await audit(prisma, actorOf(p.userId), { action: 'offers.imported', entityType: 'merchant', entityId: merchantId, merchantId, data: { rows: results.length, errors: results.filter((x) => x.status === 'error').length } });
    return { dryRun, results, summary: { created: results.filter((x) => x.status === 'created').length, updated: results.filter((x) => x.status === 'updated').length, errors: results.filter((x) => x.status === 'error').length } };
  });

  // ── orders
  const moInclude = {
    items: true,
    order: { select: { id: true, number: true, addressSnapshot: true, createdAt: true, paidAt: true, status: true } },
    groups: { include: { originLocation: { select: { id: true, name: true, city: true } } } },
    shipments: { include: { events: { orderBy: { occurredAt: 'asc' } } }, orderBy: { createdAt: 'asc' } },
    returnCases: { include: { items: true } },
  } satisfies Prisma.MerchantOrderInclude;

  /** Customer contact details are only visible to the merchant after acceptance and while fulfilling. */
  function redactAddress(mo: { status: MerchantOrderStatus; order: { addressSnapshot: Prisma.JsonValue } }) {
    const a = (mo.order.addressSnapshot ?? {}) as Record<string, unknown>;
    if (['ACCEPTED', 'PACKING', 'READY_FOR_PICKUP'].includes(mo.status)) return a;
    return { city: a.city, district: a.district, kind: a.kind };
  }

  app.get('/v1/merchants/:merchantId/orders', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    const q = parse(pageQuery.extend({ status: z.string().optional() }), req.query);
    const statuses = q.status?.split(',').filter((x): x is MerchantOrderStatus => x in MerchantOrderStatusEnum);
    const where: Prisma.MerchantOrderWhereInput = { merchantId, status: statuses?.length ? { in: statuses } : { not: 'PENDING_PAYMENT' } };
    const [total, rows] = await Promise.all([
      prisma.merchantOrder.count({ where }),
      prisma.merchantOrder.findMany({ where, include: moInclude, orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }),
    ]);
    return { total, items: rows.map((m) => ({ ...m, order: { ...m.order, addressSnapshot: redactAddress(m) } })) };
  });

  app.get('/v1/merchants/:merchantId/orders/:id', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    const { id } = parse(z.object({ id: z.string() }), req.params);
    const m = await prisma.merchantOrder.findFirst({ where: { id, merchantId, status: { not: 'PENDING_PAYMENT' } }, include: moInclude });
    if (!m) throw notFound('Merchant order');
    return { ...m, order: { ...m.order, addressSnapshot: redactAddress(m) } };
  });

  const action = (name: string, fn: (actor: Actor, id: string, merchantId: string, body: unknown) => Promise<unknown>) =>
    app.post(`/v1/merchants/:merchantId/orders/:id/${name}`, async (req) => {
      const merchantId = mid(req);
      const { principal: p } = await requireMerchant(req, merchantId);
      const { id } = parse(z.object({ id: z.string() }), req.params);
      return fn(actorOf(p.userId), id, merchantId, req.body);
    });
  action('accept', (a, id, m) => acceptMerchantOrder(ctx, a, id, m));
  action('pack', (a, id, m) => startPacking(ctx, a, id, m));
  action('ready', (a, id, m) => markReady(ctx, a, id, m));
  action('reject', (a, id, m, body) => {
    const { reason } = parse(z.object({ reason: z.enum(['OUT_OF_STOCK', 'PRICE_ERROR', 'DAMAGED', 'CANNOT_FULFIL_IN_TIME', 'OTHER']), note: z.string().max(300).optional() }), body);
    return rejectMerchantOrder(ctx, a, id, reason, m);
  });

  // ── returns
  app.get('/v1/merchants/:merchantId/returns', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    const rows = await prisma.returnCase.findMany({
      where: { merchantId },
      include: { items: { include: { orderItem: true } }, merchantOrder: { select: { number: true } }, shipments: true, refunds: { select: { id: true, amountHalalas: true, status: true } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    return { items: rows };
  });

  const returnAction = (name: string, fn: (actor: Actor, id: string, merchantId: string, body: unknown) => Promise<unknown>) =>
    app.post(`/v1/merchants/:merchantId/returns/:id/${name}`, async (req) => {
      const merchantId = mid(req);
      const { principal: p } = await requireMerchant(req, merchantId, 'MANAGER');
      const { id } = parse(z.object({ id: z.string() }), req.params);
      return fn(actorOf(p.userId), id, merchantId, req.body ?? {});
    });
  returnAction('approve', (a, id, m, b) => decideReturn(a, id, true, parse(z.object({ note: z.string().max(300).optional() }), b).note, m));
  returnAction('reject', (a, id, m, b) => decideReturn(a, id, false, parse(z.object({ note: z.string().min(2).max(300) }), b).note, m));
  returnAction('receive', (a, id, m) => markReturnReceived(a, id, m));
  returnAction('inspect', (a, id, m, b) =>
    inspectReturn(ctx, a, id, parse(z.object({ accept: z.boolean(), restock: z.boolean().default(false), refundHalalas: z.number().int().positive().optional(), note: z.string().max(300).optional() }), b), m),
  );

  // ── finance
  app.get('/v1/merchants/:merchantId/settlements', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId, 'MANAGER');
    const [settlements, balance, eligible] = await Promise.all([
      prisma.settlement.findMany({ where: { merchantId }, include: { lines: { include: { merchantOrder: { select: { number: true } } } } }, orderBy: { createdAt: 'desc' } }),
      finance.merchantBalance(merchantId),
      finance.eligibleMerchantOrders(ctx, merchantId),
    ]);
    return { settlements, balance, eligibleNetHalalas: eligible.reduce((s, l) => s + l.netHalalas, 0), eligibleOrders: eligible.length };
  });

  // ── notifications & activity
  app.get('/v1/merchants/:merchantId/notifications', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    return { notifications: await prisma.notification.findMany({ where: { merchantId, audience: 'MERCHANT' }, orderBy: { createdAt: 'desc' }, take: 50 }) };
  });

  app.post('/v1/merchants/:merchantId/notifications/read', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId);
    await prisma.notification.updateMany({ where: { merchantId, audience: 'MERCHANT', readAt: null }, data: { readAt: new Date() } });
    return { ok: true };
  });

  app.get('/v1/merchants/:merchantId/activity', async (req) => {
    const merchantId = mid(req);
    await requireMerchant(req, merchantId, 'MANAGER');
    return { events: await prisma.auditEvent.findMany({ where: { merchantId }, orderBy: { createdAt: 'desc' }, take: 100 }) };
  });
}

/** Document uploads (verification documents). Separate registration keeps merchantRoutes readable. */
export async function merchantUploadRoutes(app: FastifyInstance, deps: Deps) {
  const { requireMerchant } = deps.guards;
  const { uploads } = deps.ctx;

  app.post('/v1/merchants/:merchantId/uploads', async (req) => {
    const { merchantId } = parse(z.object({ merchantId: z.string().max(64) }), req.params);
    await requireMerchant(req, merchantId, 'MANAGER');
    const body = parse(z.object({ purpose: z.enum(['verification']), contentType: z.string(), sizeBytes: z.number().int(), fileName: z.string().min(1).max(200) }), req.body);
    return uploads.createUpload({ prefix: `merchants/${merchantId}/${body.purpose}`, contentType: body.contentType, sizeBytes: body.sizeBytes, fileName: body.fileName });
  });

  app.get('/v1/merchants/:merchantId/uploads', async (req) => {
    const { merchantId } = parse(z.object({ merchantId: z.string().max(64) }), req.params);
    await requireMerchant(req, merchantId);
    const { key } = parse(z.object({ key: z.string().max(300) }), req.query);
    if (!key.startsWith(`merchants/${merchantId}/`)) throw notFound('File');
    return { url: await uploads.downloadUrl(key) };
  });
}
