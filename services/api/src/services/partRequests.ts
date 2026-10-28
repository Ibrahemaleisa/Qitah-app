
import type { Condition, PartOrigin, PartQuote, PartRequest, Prisma } from '@prisma/client';

import type { Ctx } from '../context.js';
import { prisma, withTx, type Db, type Tx } from '../db.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { shortCode } from '../lib/ids.js';
import { normalizePartNumber } from '../lib/text.js';
import { presentProduct, presentSellers, refreshSearchText } from './catalog.js';
import { audit, emit, notify, type Actor } from './events.js';
import { customerUploadPrefix } from './uploads.js';

/**
 * Part requests ("اطلب قطعة" / RFQ).
 *
 * A customer describes a part they cannot find (vehicle, free text, optional part number, ≤3 photos).
 * Matching merchants answer with one quote each. Accepting a quote creates a PRIVATE Offer (inventory =
 * quote quantity) that only this customer can plan/check out, until the quote's `validUntil`. From there
 * the ordinary checkout → payment → fulfilment → returns → settlement flow runs unchanged.
 *
 * Merchant matching rule (v1, deliberately simple): a merchant sees an OPEN/QUOTED, unexpired request when
 *   (a) the request's delivery city is one of the merchant's operating cities — its registered city or the
 *       city of any active pickup location — OR
 *   (b) the request's vehicle make is a make that one of the merchant's ACTIVE public offers fits
 *       (via product fitment).
 */

export const REQUEST_TTL_HOURS = 72;
export const DEFAULT_QUOTE_VALID_HOURS = 24;
export const MAX_QUOTE_VALID_HOURS = 168;
export const MAX_PHOTOS = 3;
/** The committee's target: ≥70% of requests get a first quote within 15 minutes. */
export const FIRST_QUOTE_TARGET_MINUTES = 15;
/** Defaults for the DRAFT product created from a free-text quote (ops curates the real values later). */
const DRAFT_PHYSICAL = { weightGrams: 2000, lengthCm: 30, widthCm: 20, heightCm: 15 };

const OPEN_STATUSES = ['OPEN', 'QUOTED'] as const;
export const requestNumber = () => `RQ-${shortCode(7)}`;

/**
 * Customer photo keys use an opaque per-customer folder (a hash, not the user id) because merchants see the
 * signed URL, and the key must not reveal who the customer is.
 */
export const customerPhotoPrefix = (userId: string) => customerUploadPrefix(userId, 'part-request');
export const merchantPhotoPrefix = (merchantId: string) => `merchants/${merchantId}/part-quote/`;

// ───────────────────────────────────────────── matching

export type MerchantScope = { cities: string[]; makeIds: string[] };

export async function merchantScope(db: Db, merchantId: string): Promise<MerchantScope> {
  const merchant = await db.merchant.findUnique({ where: { id: merchantId }, include: { locations: { where: { active: true }, select: { city: true } } } });
  if (!merchant) return { cities: [], makeIds: [] };
  const makes = await db.vehicleModel.findMany({
    where: { fitments: { some: { product: { offers: { some: { merchantId, status: 'ACTIVE', visibility: 'PUBLIC' } } } } } },
    select: { makeId: true },
    distinct: ['makeId'],
  });
  return { cities: [...new Set([merchant.city, ...merchant.locations.map((l) => l.city)])], makeIds: makes.map((m) => m.makeId) };
}

const matchesScope = (scope: MerchantScope): Prisma.PartRequestWhereInput => ({ OR: [{ city: { in: scope.cities } }, { makeId: { in: scope.makeIds } }] });
const openWhere = (now: Date): Prisma.PartRequestWhereInput => ({ status: { in: [...OPEN_STATUSES] }, expiresAt: { gt: now } });

/** Approved merchants that match a request (for notifications). */
export async function matchingMerchantIds(db: Db, r: { city: string; makeId: string }) {
  const rows = await db.merchant.findMany({
    where: {
      status: 'APPROVED',
      OR: [
        { city: r.city },
        { locations: { some: { city: r.city, active: true } } },
        { offers: { some: { status: 'ACTIVE', visibility: 'PUBLIC', product: { fitments: { some: { model: { makeId: r.makeId } } } } } } },
      ],
    },
    select: { id: true },
    take: 500,
  });
  return rows.map((m) => m.id);
}

/** A merchant may read a request when it matches and is still open, or when it already quoted on it. */
async function loadRequestForMerchant(db: Db, merchantId: string, id: string, now = new Date()) {
  const r = await db.partRequest.findUnique({ where: { id }, include: { quotes: { where: { merchantId } } } });
  if (!r) throw notFound('Part request');
  if (r.quotes.length) return r;
  const scope = await merchantScope(db, merchantId);
  const open = (OPEN_STATUSES as readonly string[]).includes(r.status) && r.expiresAt > now;
  if (!open || !(scope.cities.includes(r.city) || scope.makeIds.includes(r.makeId))) throw notFound('Part request');
  return r;
}

// ───────────────────────────────────────────── presentation

type Vehicles = Map<string, { modelId: string; nameAr: string; nameEn: string; makeId: string; makeNameAr: string; makeNameEn: string }>;

async function vehicleNames(modelIds: string[]): Promise<Vehicles> {
  const models = await prisma.vehicleModel.findMany({ where: { id: { in: [...new Set(modelIds)] } }, include: { make: true } });
  return new Map(models.map((m) => [m.id, { modelId: m.id, nameAr: m.nameAr, nameEn: m.nameEn, makeId: m.makeId, makeNameAr: m.make.nameAr, makeNameEn: m.make.nameEn }]));
}

function presentVehicle(r: PartRequest, vehicles: Vehicles) {
  const v = vehicles.get(r.modelId);
  return {
    makeId: r.makeId,
    modelId: r.modelId,
    year: r.year,
    engine: r.engine,
    vin: r.vin,
    label: { ar: `${v?.makeNameAr ?? ''} ${v?.nameAr ?? r.modelId} ${r.year}`.trim(), en: `${v?.makeNameEn ?? ''} ${v?.nameEn ?? r.modelId} ${r.year}`.trim() },
  };
}

const lower = (v: string) => v.toLowerCase();

function presentRequestCore(r: PartRequest, vehicles: Vehicles) {
  return {
    id: r.id,
    number: r.number,
    status: r.status,
    vehicle: presentVehicle(r, vehicles),
    description: r.description,
    partNumber: r.partNumber,
    quantity: r.quantity,
    preferredCondition: lower(r.preferredCondition),
    preferredOrigin: lower(r.preferredOrigin),
    city: r.city,
    photoCount: r.photoKeys.length,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    firstQuotedAt: r.firstQuotedAt?.toISOString() ?? null,
    acceptedAt: r.acceptedAt?.toISOString() ?? null,
  };
}

async function signedPhotos(ctx: Ctx, keys: string[]) {
  return Promise.all(keys.map(async (key) => ({ url: await ctx.uploads.downloadUrl(key) })));
}

type ProductLite = { id: string; nameAr: string; nameEn: string; brand: string; partNumber: string; origin: PartOrigin; status: string };

async function productsById(ids: (string | null)[]) {
  const list = ids.filter((x): x is string => !!x);
  if (!list.length) return new Map<string, ProductLite>();
  const rows = await prisma.product.findMany({ where: { id: { in: list } }, select: { id: true, nameAr: true, nameEn: true, brand: true, partNumber: true, origin: true, status: true } });
  return new Map(rows.map((p) => [p.id, p]));
}

function quotePart(q: PartQuote, products: Map<string, ProductLite>) {
  const p = q.productId ? products.get(q.productId) : undefined;
  return {
    productId: p && p.status === 'ACTIVE' ? p.id : null,
    name: p ? { ar: p.nameAr, en: p.nameEn } : { ar: q.partName ?? '', en: q.partName ?? '' },
    brand: p?.brand ?? q.brand ?? null,
    partNumber: p?.partNumber ?? q.partNumber ?? null,
    origin: p ? lower(p.origin) : q.origin ? lower(q.origin) : null,
  };
}

function quoteTerms(q: PartQuote) {
  return {
    condition: lower(q.condition),
    priceHalalas: q.priceHalalas,
    quantity: q.quantity,
    warrantyMonths: q.warrantyMonths,
    dispatchDays: [q.dispatchDaysMin, q.dispatchDaysMax] as [number, number],
    note: q.note,
    validUntil: q.validUntil.toISOString(),
  };
}

// ───────────────────────────────────────────── customer

export type CreateRequestInput = {
  vehicleId?: string;
  vehicle?: { modelId: string; year: number; engine?: string; vin?: string };
  description: string;
  partNumber?: string;
  quantity: number;
  photoKeys: string[];
  preferredCondition: 'ANY' | 'NEW' | 'USED';
  preferredOrigin: 'ANY' | 'OEM' | 'AFTERMARKET';
  addressId?: string;
  city?: string;
};

export async function createPartRequest(ctx: Ctx, userId: string, input: CreateRequestInput) {
  let vehicle: { garageVehicleId?: string; modelId: string; year: number; engine?: string | null; vin?: string | null };
  if (input.vehicleId) {
    const v = await prisma.garageVehicle.findFirst({ where: { id: input.vehicleId, userId, deletedAt: null } });
    if (!v) throw notFound('Vehicle');
    vehicle = { garageVehicleId: v.id, modelId: v.modelId, year: v.year, engine: v.engine, vin: v.vin };
  } else if (input.vehicle) {
    vehicle = { ...input.vehicle, vin: input.vehicle.vin?.toUpperCase() };
  } else throw badRequest('VEHICLE_REQUIRED', 'Choose the vehicle the part is for');
  const model = await prisma.vehicleModel.findUnique({ where: { id: vehicle.modelId } });
  if (!model) throw badRequest('INVALID_VEHICLE', 'Unknown vehicle model');
  if (vehicle.year < model.yearFrom || vehicle.year > model.yearTo) throw badRequest('INVALID_YEAR', `Model years ${model.yearFrom}–${model.yearTo}`);

  let city = input.city;
  if (input.addressId) {
    const a = await prisma.address.findFirst({ where: { id: input.addressId, userId, deletedAt: null } });
    if (!a) throw notFound('Address');
    city = a.city;
  }
  if (!city) throw badRequest('CITY_REQUIRED', 'Choose a delivery address or city');

  const photoKeys = [...new Set(input.photoKeys)];
  if (photoKeys.length > MAX_PHOTOS) throw badRequest('TOO_MANY_PHOTOS', `Attach at most ${MAX_PHOTOS} photos`);
  if (photoKeys.some((k) => !k.startsWith(customerPhotoPrefix(userId)) || k.includes('..'))) throw badRequest('INVALID_PHOTO', 'Photos must be uploaded through /v1/me/uploads');
  if (!input.description.trim() && !input.partNumber?.trim() && !photoKeys.length) throw badRequest('DESCRIPTION_REQUIRED', 'Describe the part, add its number or a photo');

  const now = new Date();
  const created = await withTx(async (tx) => {
    const r = await tx.partRequest.create({
      data: {
        number: requestNumber(),
        customerId: userId,
        garageVehicleId: vehicle.garageVehicleId,
        makeId: model.makeId,
        modelId: model.id,
        year: vehicle.year,
        engine: vehicle.engine ?? null,
        vin: vehicle.vin ?? null,
        description: input.description.trim(),
        partNumber: input.partNumber?.trim() || null,
        quantity: input.quantity,
        photoKeys,
        preferredCondition: input.preferredCondition,
        preferredOrigin: input.preferredOrigin,
        addressId: input.addressId ?? null,
        city,
        expiresAt: new Date(now.getTime() + REQUEST_TTL_HOURS * 3600_000),
      },
    });
    const merchantIds = await matchingMerchantIds(tx, r);
    const actor: Actor = { userId, type: 'customer' };
    await audit(tx, actor, { action: 'part_request.created', entityType: 'part_request', entityId: r.id, data: { number: r.number, city: r.city, makeId: r.makeId, matchedMerchants: merchantIds.length } });
    await emit(tx, { type: 'part_request.created', entityType: 'part_request', entityId: r.id, customerId: userId, merchantIds, payload: { number: r.number, city: r.city } });
    await notify(tx, { audience: 'OPS', type: 'part_request.created', title: 'طلب قطعة جديد', body: `${r.number} — ${model.nameAr} ${r.year}`, data: { partRequestId: r.id } });
    if (merchantIds.length) {
      await tx.notification.createMany({
        data: merchantIds.map((merchantId) => ({ audience: 'MERCHANT' as const, merchantId, type: 'part_request.created', title: 'طلب قطعة جديد', body: `${model.nameAr} ${r.year}: ${r.description.slice(0, 80)}`, data: { partRequestId: r.id } })),
      });
    }
    return r;
  });
  return getCustomerRequest(ctx, userId, created.id);
}

export async function listCustomerRequests(userId: string) {
  const rows = await prisma.partRequest.findMany({
    where: { customerId: userId },
    include: { quotes: { where: { status: { in: ['ACTIVE', 'ACCEPTED'] } }, select: { priceHalalas: true, status: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
  const vehicles = await vehicleNames(rows.map((r) => r.modelId));
  return rows.map((r) => ({
    ...presentRequestCore(r, vehicles),
    quoteCount: r.quotes.length,
    bestPriceHalalas: r.quotes.length ? Math.min(...r.quotes.map((q) => q.priceHalalas)) : null,
  }));
}

export async function getCustomerRequest(ctx: Ctx, userId: string, id: string) {
  const r = await prisma.partRequest.findFirst({
    where: { id, customerId: userId },
    include: { quotes: { where: { status: { in: ['ACTIVE', 'ACCEPTED'] } }, orderBy: { priceHalalas: 'asc' } } },
  });
  if (!r) throw notFound('Part request');
  const [vehicles, products, sellers] = await Promise.all([
    vehicleNames([r.modelId]),
    productsById(r.quotes.map((q) => q.productId)),
    presentSellers([...new Set(r.quotes.map((q) => q.merchantId))]),
  ]);
  const locations = await prisma.pickupLocation.findMany({ where: { id: { in: r.quotes.map((q) => q.locationId) } }, select: { id: true, city: true } });
  const now = new Date();
  return {
    ...presentRequestCore(r, vehicles),
    photos: await signedPhotos(ctx, r.photoKeys),
    quotes: await Promise.all(
      r.quotes.map(async (q) => {
        const seller = sellers.find((s) => s.id === q.merchantId);
        return {
          id: q.id,
          status: q.status,
          expired: q.validUntil <= now,
          merchant: { id: q.merchantId, name: seller?.name ?? { ar: '', en: '' }, city: seller?.city ?? null, verifiedBusiness: seller?.verifiedBusiness ?? false },
          seller: seller ?? null,
          originCity: locations.find((l) => l.id === q.locationId)?.city ?? null,
          part: quotePart(q, products),
          ...quoteTerms(q),
          photoUrl: q.photoKey ? await ctx.uploads.downloadUrl(q.photoKey) : null,
          offerId: q.status === 'ACCEPTED' ? q.offerId : null,
        };
      }),
    ),
  };
}

export async function cancelPartRequest(userId: string, id: string) {
  return withTx(async (tx) => {
    const r = await lockRequest(tx, id);
    if (!r || r.customerId !== userId) throw notFound('Part request');
    if (!(OPEN_STATUSES as readonly string[]).includes(r.status)) throw conflict('REQUEST_CLOSED', 'This request is no longer open');
    const active = await tx.partQuote.findMany({ where: { requestId: id, status: 'ACTIVE' }, select: { merchantId: true } });
    await tx.partQuote.updateMany({ where: { requestId: id, status: 'ACTIVE' }, data: { status: 'DECLINED' } });
    await tx.partRequest.update({ where: { id }, data: { status: 'CANCELLED', cancelledAt: new Date() } });
    await audit(tx, { userId, type: 'customer' }, { action: 'part_request.cancelled', entityType: 'part_request', entityId: id });
    await emit(tx, { type: 'part_request.cancelled', entityType: 'part_request', entityId: id, customerId: userId, merchantIds: active.map((q) => q.merchantId) });
    return { ok: true };
  });
}

async function lockRequest(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "PartRequest" WHERE id = ${id} FOR UPDATE`;
  if (!rows.length) return null;
  return tx.partRequest.findUniqueOrThrow({ where: { id } });
}

/**
 * Accepts a quote: creates the private offer (and, for a free-text quote, a DRAFT canonical product for
 * ops to curate), closes the competing quotes and returns everything the app needs to put the offer in
 * the cart and go through the normal checkout.
 */
export async function acceptQuote(userId: string, requestId: string, quoteId: string) {
  const now = new Date();
  const result = await withTx(async (tx) => {
    const r = await lockRequest(tx, requestId);
    if (!r || r.customerId !== userId) throw notFound('Part request');
    if (!(OPEN_STATUSES as readonly string[]).includes(r.status) || r.expiresAt <= now) throw conflict('REQUEST_CLOSED', 'This request is no longer open');
    const q = await tx.partQuote.findFirst({ where: { id: quoteId, requestId } });
    if (!q || q.status !== 'ACTIVE') throw conflict('QUOTE_UNAVAILABLE', 'This offer is no longer available');
    if (q.validUntil <= now) throw conflict('QUOTE_EXPIRED', 'This offer has expired');
    const merchant = await tx.merchant.findUnique({ where: { id: q.merchantId } });
    const location = await tx.pickupLocation.findFirst({ where: { id: q.locationId, merchantId: q.merchantId, active: true } });
    if (merchant?.status !== 'APPROVED' || !location) throw conflict('QUOTE_UNAVAILABLE', 'This seller cannot take orders right now');

    let productId = q.productId;
    let draftCreated = false;
    if (productId) {
      const p = await tx.product.findFirst({ where: { id: productId, status: 'ACTIVE' } });
      if (!p) throw conflict('QUOTE_UNAVAILABLE', 'The quoted product is no longer in the catalog');
    } else {
      productId = await createDraftProduct(tx, r, q);
      draftCreated = true;
    }

    const offer = await tx.offer.create({
      data: {
        merchantId: q.merchantId,
        productId,
        locationId: q.locationId,
        sku: `RFQ-${r.number}`,
        condition: q.condition,
        priceHalalas: q.priceHalalas,
        warrantyMonths: q.warrantyMonths,
        dispatchDaysMin: q.dispatchDaysMin,
        dispatchDaysMax: q.dispatchDaysMax,
        noteAr: q.note,
        noteEn: q.note,
        visibility: 'PRIVATE',
        privateForUserId: userId,
        inventory: { create: { onHand: q.quantity } },
      },
    });
    await tx.inventoryAdjustment.create({ data: { offerId: offer.id, delta: q.quantity, onHandAfter: q.quantity, reason: 'INITIAL', note: `Part request ${r.number}`, refType: 'part_quote', refId: q.id, actorUserId: userId } });
    await tx.partQuote.update({ where: { id: q.id }, data: { status: 'ACCEPTED', acceptedAt: now, offerId: offer.id, productId } });
    const losers = await tx.partQuote.findMany({ where: { requestId, status: 'ACTIVE', id: { not: q.id } }, select: { merchantId: true } });
    await tx.partQuote.updateMany({ where: { requestId, status: 'ACTIVE', id: { not: q.id } }, data: { status: 'DECLINED' } });
    await tx.partRequest.update({ where: { id: requestId }, data: { status: 'ACCEPTED', acceptedQuoteId: q.id, acceptedAt: now } });

    const actor: Actor = { userId, type: 'customer' };
    await audit(tx, actor, { action: 'part_quote.accepted', entityType: 'part_request', entityId: requestId, merchantId: q.merchantId, data: { quoteId: q.id, offerId: offer.id, productId, draftProduct: draftCreated, priceHalalas: q.priceHalalas } });
    if (draftCreated) await audit(tx, actor, { action: 'product.draft_from_part_request', entityType: 'product', entityId: productId, merchantId: q.merchantId, data: { requestId, quoteId: q.id } });
    await emit(tx, { type: 'part_quote.accepted', entityType: 'part_request', entityId: requestId, customerId: userId, merchantIds: [q.merchantId], payload: { quoteId: q.id, offerId: offer.id } });
    // Other quoting merchants only learn that the request closed, never who won or at what price.
    if (losers.length) await emit(tx, { type: 'part_request.closed', entityType: 'part_request', entityId: requestId, merchantIds: losers.map((l) => l.merchantId) });
    await notify(tx, { audience: 'MERCHANT', merchantId: q.merchantId, type: 'part_quote.accepted', title: 'تم قبول عرضك', body: `قبل العميل عرضك على الطلب ${r.number}. سيصلك الطلب بعد الدفع.`, data: { partRequestId: requestId, quoteId: q.id, offerId: offer.id } });
    return { offerId: offer.id, quantity: q.quantity, merchantId: q.merchantId };
  });
  const catalog = await privateCatalogForUser(userId, [result.offerId]);
  return { requestId, quoteId, offerId: result.offerId, quantity: result.quantity, product: catalog.products[0] ?? null, seller: catalog.sellers[0] ?? null };
}

async function createDraftProduct(tx: Tx, r: PartRequest, q: PartQuote) {
  // A free-text quote may omit the category: park it in the first category with a neutral illustration until ops curates it.
  const chosen = q.categoryId ? await tx.category.findUnique({ where: { id: q.categoryId } }) : null;
  const category = chosen ?? (await tx.category.findFirstOrThrow({ orderBy: { sort: 'asc' } }));
  const name = q.partName ?? r.description.slice(0, 120);
  const partNumber = q.partNumber?.trim() || r.partNumber?.trim() || `RFQ-${r.number}`;
  const product = await tx.product.create({
    data: {
      nameAr: name,
      nameEn: name,
      descriptionAr: r.description,
      descriptionEn: r.description,
      categoryId: category.id,
      brand: q.brand ?? '—',
      origin: q.origin ?? 'AFTERMARKET',
      partNumber,
      art: chosen ? category.art : 'pump',
      keywords: [],
      ...DRAFT_PHYSICAL,
      status: 'DRAFT',
      createdByMerchantId: q.merchantId,
      identifiers: q.partNumber?.trim() ? { create: [{ type: 'MPN', value: q.partNumber.trim(), normalized: normalizePartNumber(q.partNumber), brand: q.brand }] } : undefined,
      fitments: { create: [{ modelId: r.modelId, yearFrom: r.year, yearTo: r.year, engines: r.engine ? [r.engine] : [], source: 'SELLER', createdByMerchantId: q.merchantId }] },
    },
  });
  await refreshSearchText(tx, product.id);
  return product.id;
}

/** Where-clause for this customer's live private offers (status, seller, location, and quote validity). */
export function privateOfferWhere(userId: string, now = new Date()): Prisma.OfferWhereInput {
  return {
    visibility: 'PRIVATE',
    privateForUserId: userId,
    status: 'ACTIVE',
    merchant: { status: 'APPROVED' },
    location: { active: true },
    partQuote: { validUntil: { gt: now } },
  };
}

/** The customer's own private offers in the public catalog shape, so the app can show them in the cart. */
export async function privateCatalogForUser(userId: string, offerIds?: string[]) {
  const where: Prisma.OfferWhereInput = { ...privateOfferWhere(userId), ...(offerIds ? { id: { in: offerIds } } : {}) };
  const rows = await prisma.product.findMany({
    where: { status: { in: ['ACTIVE', 'DRAFT'] }, offers: { some: where } },
    include: { identifiers: true, fitments: true, offers: { where, include: { inventory: true, location: true } } },
  });
  const products = rows.map((p) => {
    const product = presentProduct(p);
    return { ...product, offers: product.offers.map((o) => ({ ...o, visibility: 'private' as const })) };
  });
  const sellers = await presentSellers([...new Set(rows.flatMap((p) => p.offers.map((o) => o.merchantId)))]);
  return { products, sellers };
}

// ───────────────────────────────────────────── merchant

export async function listMerchantInbox(merchantId: string, now = new Date()) {
  const scope = await merchantScope(prisma, merchantId);
  const rows = await prisma.partRequest.findMany({
    where: { ...openWhere(now), ...matchesScope(scope) },
    include: { quotes: { where: { merchantId } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  const vehicles = await vehicleNames(rows.map((r) => r.modelId));
  return {
    rule: 'OPEN/QUOTED, unexpired requests whose delivery city is one of your operating cities (store city or an active pickup location), or whose vehicle make matches a make your active offers fit.',
    scope,
    items: rows.map((r) => ({ ...presentRequestCore(r, vehicles), myQuote: r.quotes[0] ? presentMerchantQuote(r.quotes[0]) : null })),
  };
}

function presentMerchantQuote(q: PartQuote) {
  return {
    id: q.id,
    status: q.status,
    productId: q.productId,
    partName: q.partName,
    brand: q.brand,
    partNumber: q.partNumber,
    categoryId: q.categoryId,
    origin: q.origin,
    locationId: q.locationId,
    photoKey: q.photoKey,
    offerId: q.offerId,
    acceptedAt: q.acceptedAt?.toISOString() ?? null,
    createdAt: q.createdAt.toISOString(),
    updatedAt: q.updatedAt.toISOString(),
    ...quoteTerms(q),
    condition: q.condition,
  };
}

export async function getMerchantRequest(ctx: Ctx, merchantId: string, id: string) {
  const r = await loadRequestForMerchant(prisma, merchantId, id);
  const vehicles = await vehicleNames([r.modelId]);
  const mine = r.quotes[0];
  const product = mine?.productId ? await prisma.product.findUnique({ where: { id: mine.productId }, select: { id: true, nameAr: true, nameEn: true, brand: true, partNumber: true, status: true } }) : null;
  return {
    ...presentRequestCore(r, vehicles),
    // Customer identity and contact are never shown here; after purchase the merchant order carries them.
    photos: await signedPhotos(ctx, r.photoKeys),
    myQuote: mine ? { ...presentMerchantQuote(mine), product, photoUrl: mine.photoKey ? await ctx.uploads.downloadUrl(mine.photoKey) : null } : null,
  };
}

export type QuoteInput = {
  productId?: string | null;
  partName?: string;
  brand?: string;
  partNumber?: string;
  categoryId?: string;
  origin?: PartOrigin;
  condition: Condition;
  priceHalalas: number;
  quantity?: number;
  warrantyMonths: number;
  dispatchDaysMin: number;
  dispatchDaysMax: number;
  locationId: string;
  photoKey?: string | null;
  note?: string | null;
  validHours: number;
};

async function validateQuote(db: Db, merchantId: string, r: PartRequest, q: Partial<QuoteInput>, existing?: PartQuote) {
  const min = q.dispatchDaysMin ?? existing?.dispatchDaysMin ?? 0;
  const max = q.dispatchDaysMax ?? existing?.dispatchDaysMax ?? 1;
  if (max < min) throw badRequest('INVALID_DISPATCH', 'Max dispatch days must be ≥ min');
  if (q.locationId && !(await db.pickupLocation.findFirst({ where: { id: q.locationId, merchantId, active: true } }))) throw badRequest('INVALID_LOCATION', 'Choose one of your active pickup locations');
  if (q.quantity != null && q.quantity > r.quantity) throw badRequest('INVALID_QUANTITY', `The customer asked for ${r.quantity}`);
  if (q.photoKey && (!q.photoKey.startsWith(merchantPhotoPrefix(merchantId)) || q.photoKey.includes('..'))) throw badRequest('INVALID_PHOTO', 'Upload the photo through your store uploads (purpose part-quote)');
  if (q.categoryId && !(await db.category.findUnique({ where: { id: q.categoryId } }))) throw badRequest('INVALID_CATEGORY', 'Unknown category');
  const productId = q.productId !== undefined ? q.productId : existing?.productId;
  const partName = q.partName !== undefined ? q.partName : existing?.partName;
  if (productId) {
    if (!(await db.product.findFirst({ where: { id: productId, status: 'ACTIVE' } }))) throw badRequest('INVALID_PRODUCT', 'Unknown catalog product');
  } else if (!partName || partName.trim().length < 2) {
    throw badRequest('PART_REQUIRED', 'Link a catalog product or enter the part name');
  }
}

export async function submitQuote(merchantId: string, userId: string, requestId: string, input: QuoteInput) {
  const now = new Date();
  return withTx(async (tx) => {
    const locked = await lockRequest(tx, requestId);
    if (!locked) throw notFound('Part request');
    const r = await loadRequestForMerchant(tx, merchantId, requestId, now);
    if (r.quotes.length) throw conflict('QUOTE_EXISTS', 'You already quoted on this request; edit your quote instead');
    if (!(OPEN_STATUSES as readonly string[]).includes(r.status) || r.expiresAt <= now) throw conflict('REQUEST_CLOSED', 'This request is no longer open');
    await validateQuote(tx, merchantId, r, input);
    const product = input.productId ? await tx.product.findUnique({ where: { id: input.productId } }) : null;
    const q = await tx.partQuote.create({
      data: {
        requestId,
        merchantId,
        locationId: input.locationId,
        productId: input.productId ?? null,
        partName: product ? null : input.partName?.trim() ?? null,
        brand: product ? product.brand : input.brand?.trim() || null,
        partNumber: product ? product.partNumber : input.partNumber?.trim() || null,
        categoryId: product ? product.categoryId : input.categoryId ?? null,
        origin: product ? product.origin : input.origin ?? null,
        condition: input.condition,
        priceHalalas: input.priceHalalas,
        quantity: input.quantity ?? r.quantity,
        warrantyMonths: input.warrantyMonths,
        dispatchDaysMin: input.dispatchDaysMin,
        dispatchDaysMax: input.dispatchDaysMax,
        note: input.note?.trim() || null,
        photoKey: input.photoKey ?? null,
        validUntil: new Date(now.getTime() + input.validHours * 3600_000),
        createdById: userId,
      },
    });
    await tx.partRequest.update({ where: { id: requestId }, data: { status: 'QUOTED', firstQuotedAt: r.firstQuotedAt ?? now } });
    const actor: Actor = { userId, type: 'merchant' };
    await audit(tx, actor, { action: 'part_quote.submitted', entityType: 'part_request', entityId: requestId, merchantId, data: { quoteId: q.id, priceHalalas: q.priceHalalas, first: !r.firstQuotedAt } });
    await emit(tx, { type: 'part_request.quoted', entityType: 'part_request', entityId: requestId, customerId: r.customerId, merchantIds: [merchantId], payload: { quoteId: q.id } });
    await notify(tx, { audience: 'CUSTOMER', userId: r.customerId, type: 'part_request.quote', title: 'وصلك عرض على طلبك', body: `عرض جديد على طلب القطعة ${r.number}`, data: { partRequestId: requestId, quoteId: q.id } });
    return presentMerchantQuote(q);
  });
}

export async function updateQuote(merchantId: string, userId: string, requestId: string, input: Partial<QuoteInput>) {
  const now = new Date();
  return withTx(async (tx) => {
    const r = await lockRequest(tx, requestId);
    const q = r && (await tx.partQuote.findUnique({ where: { requestId_merchantId: { requestId, merchantId } } }));
    if (!r || !q) throw notFound('Quote');
    if (q.status !== 'ACTIVE' || !(OPEN_STATUSES as readonly string[]).includes(r.status)) throw conflict('QUOTE_LOCKED', 'Only an active quote on an open request can be edited');
    await validateQuote(tx, merchantId, r, input, q);
    const product = input.productId ? await tx.product.findUnique({ where: { id: input.productId } }) : null;
    const { validHours, ...rest } = input;
    const data: Prisma.PartQuoteUpdateInput = {
      ...rest,
      ...(product ? { partName: null, brand: product.brand, partNumber: product.partNumber, categoryId: product.categoryId, origin: product.origin } : {}),
      ...(validHours ? { validUntil: new Date(now.getTime() + validHours * 3600_000) } : {}),
    };
    const updated = await tx.partQuote.update({ where: { id: q.id }, data });
    await audit(tx, { userId, type: 'merchant' }, { action: 'part_quote.updated', entityType: 'part_request', entityId: requestId, merchantId, data: { quoteId: q.id, before: { priceHalalas: q.priceHalalas }, after: { priceHalalas: updated.priceHalalas } } });
    await emit(tx, { type: 'part_request.quoted', entityType: 'part_request', entityId: requestId, customerId: r.customerId, merchantIds: [merchantId], payload: { quoteId: q.id, updated: true } });
    return presentMerchantQuote(updated);
  });
}

export async function withdrawQuote(merchantId: string, userId: string, requestId: string) {
  return withTx(async (tx) => {
    const r = await lockRequest(tx, requestId);
    const q = r && (await tx.partQuote.findUnique({ where: { requestId_merchantId: { requestId, merchantId } } }));
    if (!r || !q) throw notFound('Quote');
    if (q.status !== 'ACTIVE') throw conflict('QUOTE_LOCKED', 'Only an active quote can be withdrawn');
    const updated = await tx.partQuote.update({ where: { id: q.id }, data: { status: 'WITHDRAWN', withdrawnAt: new Date() } });
    const remaining = await tx.partQuote.count({ where: { requestId, status: 'ACTIVE' } });
    if (!remaining && r.status === 'QUOTED') await tx.partRequest.update({ where: { id: requestId }, data: { status: 'OPEN' } });
    await audit(tx, { userId, type: 'merchant' }, { action: 'part_quote.withdrawn', entityType: 'part_request', entityId: requestId, merchantId, data: { quoteId: q.id } });
    await emit(tx, { type: 'part_request.quote_withdrawn', entityType: 'part_request', entityId: requestId, customerId: r.customerId, merchantIds: [merchantId], payload: { quoteId: q.id } });
    return presentMerchantQuote(updated);
  });
}

/** The merchant's own quotes, with outcome (won = ACCEPTED) and the resulting order once paid. */
export async function listMerchantQuotes(merchantId: string, status?: string) {
  const statuses = status?.split(',').filter((s): s is PartQuote['status'] => ['ACTIVE', 'WITHDRAWN', 'ACCEPTED', 'DECLINED', 'EXPIRED'].includes(s));
  const rows = await prisma.partQuote.findMany({
    where: { merchantId, ...(statuses?.length ? { status: { in: statuses } } : {}) },
    include: { request: true },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  const vehicles = await vehicleNames(rows.map((q) => q.request.modelId));
  const offerIds = rows.map((q) => q.offerId).filter((x): x is string => !!x);
  const items = offerIds.length
    ? await prisma.orderItem.findMany({ where: { offerId: { in: offerIds }, merchantOrder: { status: { not: 'PENDING_PAYMENT' } } }, select: { offerId: true, merchantOrder: { select: { id: true, number: true, status: true } } } })
    : [];
  return {
    items: rows.map((q) => ({
      ...presentMerchantQuote(q),
      won: q.status === 'ACCEPTED',
      request: presentRequestCore(q.request, vehicles),
      merchantOrders: items.filter((i) => i.offerId === q.offerId).map((i) => i.merchantOrder),
    })),
  };
}

// ───────────────────────────────────────────── ops

export async function opsListRequests(q: { status?: PartRequest['status']; limit: number; offset: number }, now = new Date()) {
  const where: Prisma.PartRequestWhereInput = q.status ? { status: q.status } : {};
  const [total, rows] = await Promise.all([
    prisma.partRequest.count({ where }),
    prisma.partRequest.findMany({ where, include: { quotes: { select: { status: true, merchantId: true, priceHalalas: true } } }, orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }),
  ]);
  const vehicles = await vehicleNames(rows.map((r) => r.modelId));
  const alertBefore = new Date(now.getTime() - FIRST_QUOTE_TARGET_MINUTES * 60_000);
  return {
    total,
    metrics: await opsMetrics(now),
    items: rows.map((r) => ({
      ...presentRequestCore(r, vehicles),
      customerId: r.customerId,
      quoteCount: r.quotes.filter((x) => x.status !== 'WITHDRAWN').length,
      activeQuoteCount: r.quotes.filter((x) => x.status === 'ACTIVE').length,
      timeToFirstQuoteSeconds: r.firstQuotedAt ? Math.round((r.firstQuotedAt.getTime() - r.createdAt.getTime()) / 1000) : null,
      unansweredOverTarget: !r.firstQuotedAt && (OPEN_STATUSES as readonly string[]).includes(r.status) && r.expiresAt > now && r.createdAt < alertBefore,
    })),
  };
}

/** Rolling 30-day RFQ health: share of requests answered within the 15-minute target. */
export async function opsMetrics(now = new Date()) {
  const since = new Date(now.getTime() - 30 * 86_400_000);
  const alertBefore = new Date(now.getTime() - FIRST_QUOTE_TARGET_MINUTES * 60_000);
  const rows = await prisma.$queryRaw<{ total: bigint; eligible: bigint; answered: bigint; within: bigint; median: number | null }[]>`
    SELECT count(*)::bigint AS total,
           count(*) FILTER (WHERE "firstQuotedAt" IS NOT NULL OR "createdAt" < ${alertBefore})::bigint AS eligible,
           count("firstQuotedAt")::bigint AS answered,
           count(*) FILTER (WHERE "firstQuotedAt" IS NOT NULL AND EXTRACT(EPOCH FROM "firstQuotedAt" - "createdAt") <= ${FIRST_QUOTE_TARGET_MINUTES * 60})::bigint AS within,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM "firstQuotedAt" - "createdAt")::float8) FILTER (WHERE "firstQuotedAt" IS NOT NULL) AS median
    FROM "PartRequest" WHERE "createdAt" >= ${since}`;
  const m = rows[0];
  const unanswered = await prisma.partRequest.count({ where: { ...openWhere(now), firstQuotedAt: null, createdAt: { lt: alertBefore } } });
  const eligible = Number(m?.eligible ?? 0);
  const within = Number(m?.within ?? 0);
  return {
    windowDays: 30,
    targetMinutes: FIRST_QUOTE_TARGET_MINUTES,
    targetRate: 0.7,
    total: Number(m?.total ?? 0),
    answered: Number(m?.answered ?? 0),
    answeredWithinTarget: within,
    withinTargetRate: eligible ? within / eligible : null,
    medianSecondsToFirstQuote: m?.median == null ? null : Math.round(Number(m.median)),
    unansweredOverTarget: unanswered,
  };
}

export async function opsGetRequest(ctx: Ctx, id: string) {
  const r = await prisma.partRequest.findUnique({ where: { id }, include: { quotes: { orderBy: { createdAt: 'asc' } } } });
  if (!r) throw notFound('Part request');
  const [vehicles, merchants] = await Promise.all([
    vehicleNames([r.modelId]),
    prisma.merchant.findMany({ where: { id: { in: r.quotes.map((q) => q.merchantId) } }, select: { id: true, displayNameAr: true, displayNameEn: true } }),
  ]);
  return {
    ...presentRequestCore(r, vehicles),
    customerId: r.customerId,
    photos: await signedPhotos(ctx, r.photoKeys),
    quotes: r.quotes.map((q) => ({ ...presentMerchantQuote(q), merchant: merchants.find((m) => m.id === q.merchantId) ?? null, secondsAfterRequest: Math.round((q.createdAt.getTime() - r.createdAt.getTime()) / 1000) })),
  };
}

// ───────────────────────────────────────────── worker

/**
 * Idempotent expiry (safe on several workers): conditional updates only change rows still in the
 * expected state. Expires quotes past `validUntil`, re-opens requests left without an active quote,
 * expires requests past `expiresAt`, and archives private offers whose quote validity ended.
 */
export async function expirePartRequests(now = new Date()) {
  const quotes = await prisma.partQuote.updateMany({ where: { status: 'ACTIVE', validUntil: { lte: now } }, data: { status: 'EXPIRED' } });
  const reopened = await prisma.partRequest.updateMany({ where: { status: 'QUOTED', quotes: { none: { status: 'ACTIVE' } } }, data: { status: 'OPEN' } });
  const due = await prisma.partRequest.findMany({ where: { status: { in: [...OPEN_STATUSES] }, expiresAt: { lte: now } }, select: { id: true }, take: 500 });
  let requests = 0;
  for (const { id } of due) {
    await withTx(async (tx) => {
      const r = await tx.partRequest.updateMany({ where: { id, status: { in: [...OPEN_STATUSES] }, expiresAt: { lte: now } }, data: { status: 'EXPIRED' } });
      if (!r.count) return;
      requests += 1;
      await tx.partQuote.updateMany({ where: { requestId: id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
      const row = await tx.partRequest.findUniqueOrThrow({ where: { id } });
      await audit(tx, { type: 'system' }, { action: 'part_request.expired', entityType: 'part_request', entityId: id });
      await notify(tx, { audience: 'CUSTOMER', userId: row.customerId, type: 'part_request.expired', title: 'انتهت مدة طلب القطعة', body: `انتهت مدة الطلب ${row.number}. يمكنك إرسال طلب جديد.`, data: { partRequestId: id } });
    });
  }
  const offers = await prisma.offer.updateMany({ where: { visibility: 'PRIVATE', status: 'ACTIVE', partQuote: { validUntil: { lte: now } } }, data: { status: 'ARCHIVED' } });
  return quotes.count + reopened.count + requests + offers.count;
}
