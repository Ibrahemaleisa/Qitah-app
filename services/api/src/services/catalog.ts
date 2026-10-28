import type { Prisma } from '@prisma/client';

import { prisma, type Db } from '../db.js';
import { notFound } from '../lib/errors.js';
import { normalizePartNumber, normalizeText } from '../lib/text.js';

/** Builds the normalised search text stored on Product. */
export function buildSearchText(p: { nameAr: string; nameEn: string; brand: string; keywords: string[]; partNumber: string; identifiers?: string[]; categoryNames?: string[] }) {
  const parts = [p.nameAr, p.nameEn, p.brand, ...p.keywords, ...(p.categoryNames ?? [])].map(normalizeText);
  const numbers = [p.partNumber, ...(p.identifiers ?? [])].map(normalizePartNumber);
  return [...parts, ...numbers].join(' ');
}

export async function refreshSearchText(db: Db, productId: string) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { identifiers: true, category: true } });
  await db.product.update({
    where: { id: productId },
    data: {
      searchText: buildSearchText({
        ...p,
        identifiers: p.identifiers.map((i) => i.value),
        categoryNames: [p.category.nameAr, p.category.nameEn],
      }),
    },
  });
}

/** Public listing filter. PRIVATE offers (accepted part-request quotes) never appear in catalog, search, snapshot or seller pages. */
export const publicOfferWhere: Prisma.OfferWhereInput = {
  visibility: 'PUBLIC',
  status: 'ACTIVE',
  merchant: { status: 'APPROVED' },
  location: { active: true },
};

const offerInclude = { inventory: true, location: true } satisfies Prisma.OfferInclude;
type OfferRow = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

export function presentOffer(o: OfferRow) {
  return {
    id: o.id,
    productId: o.productId,
    sellerId: o.merchantId,
    priceHalalas: o.priceHalalas,
    compareAtHalalas: o.compareAtHalalas,
    available: o.inventory ? Math.max(0, o.inventory.onHand - o.inventory.reserved) : 0,
    condition: o.condition.toLowerCase(),
    warrantyMonths: o.warrantyMonths,
    dispatchDays: [o.dispatchDaysMin, o.dispatchDaysMax],
    originCity: o.location.city,
    noteAr: o.noteAr,
    noteEn: o.noteEn,
    updatedAt: o.updatedAt.toISOString(),
  };
}

const productInclude = {
  identifiers: true,
  fitments: true,
  offers: { where: publicOfferWhere, include: offerInclude },
} satisfies Prisma.ProductInclude;
type ProductRow = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

export function presentProduct(p: ProductRow) {
  return {
    id: p.id,
    name: { ar: p.nameAr, en: p.nameEn },
    description: { ar: p.descriptionAr, en: p.descriptionEn },
    categoryId: p.categoryId,
    brand: p.brand,
    origin: p.origin === 'OEM' ? 'oem' : 'aftermarket',
    partNumber: p.partNumber,
    oemReferences: p.identifiers.filter((i) => i.type === 'OEM').map((i) => i.value),
    specs: p.specs,
    universal: p.universalNoteAr ? { note: { ar: p.universalNoteAr, en: p.universalNoteEn ?? p.universalNoteAr } } : undefined,
    fitment: p.fitments.map((f) => ({
      modelId: f.modelId,
      yearFrom: f.yearFrom,
      yearTo: f.yearTo,
      engines: f.engines.length ? f.engines : undefined,
      source: f.source === 'CATALOG' ? 'catalog' : 'seller',
    })),
    art: p.art,
    keywords: p.keywords,
    handling: p.handling,
    weightGrams: p.weightGrams,
    /** No verified reviews exist yet: ratings are intentionally null rather than invented. */
    rating: null,
    offers: p.offers.map(presentOffer),
  };
}

export async function sellerStats(merchantIds: string[]) {
  const delivered = await prisma.merchantOrder.groupBy({ by: ['merchantId'], where: { merchantId: { in: merchantIds }, status: 'DELIVERED' }, _count: true });
  const onTime = await prisma.merchantOrder.groupBy({ by: ['merchantId'], where: { merchantId: { in: merchantIds }, status: 'DELIVERED', slaBreached: false }, _count: true });
  return new Map(
    merchantIds.map((id) => {
      const d = delivered.find((x) => x.merchantId === id)?._count ?? 0;
      const o = onTime.find((x) => x.merchantId === id)?._count ?? 0;
      return [id, { fulfilledOrders: d, onTimeRate: d >= 5 ? o / d : null }];
    }),
  );
}

export async function presentSellers(merchantIds: string[]) {
  const merchants = await prisma.merchant.findMany({ where: { id: { in: merchantIds } }, include: { verifications: { where: { status: 'APPROVED' }, take: 1 } } });
  const stats = await sellerStats(merchantIds);
  return merchants.map((m) => ({
    id: m.id,
    name: { ar: m.displayNameAr, en: m.displayNameEn },
    city: m.city,
    verifiedBusiness: m.status === 'APPROVED' && m.verifications.length > 0,
    joinedYear: m.createdAt.getUTCFullYear(),
    rating: null,
    fulfilledOrders: stats.get(m.id)?.fulfilledOrders ?? 0,
    onTimeRate: stats.get(m.id)?.onTimeRate ?? null,
    responseHours: Math.max(1, Math.round(m.slaAcceptMinutes / 60)),
    supportsWorkshopDelivery: m.supportsWorkshopDelivery,
    specialty: { ar: m.specialtyAr, en: m.specialtyEn },
    active: m.status === 'APPROVED',
  }));
}

export type ProductQuery = {
  q?: string;
  categoryId?: string;
  modelId?: string;
  year?: number;
  engine?: string;
  fitsOnly?: boolean;
  merchantId?: string;
  limit: number;
  offset: number;
};

export async function searchCatalog(query: ProductQuery) {
  const where: Prisma.ProductWhereInput = { status: 'ACTIVE' };
  const and: Prisma.ProductWhereInput[] = [];
  if (query.categoryId) and.push({ categoryId: query.categoryId });
  if (query.q?.trim()) {
    const tokens = normalizeText(query.q).split(/\s+/).filter(Boolean);
    const pn = normalizePartNumber(query.q);
    and.push({
      OR: [
        { AND: tokens.map((t) => ({ searchText: { contains: t } })) },
        ...(pn.length >= 4 ? [{ searchText: { contains: pn } }] : []),
      ],
    });
  }
  if (query.fitsOnly && query.modelId && query.year) {
    and.push({
      OR: [
        { universalNoteAr: { not: null } },
        {
          fitments: {
            some: {
              modelId: query.modelId,
              yearFrom: { lte: query.year },
              yearTo: { gte: query.year },
              ...(query.engine ? { OR: [{ engines: { isEmpty: true } }, { engines: { has: query.engine } }] } : {}),
            },
          },
        },
      ],
    });
  }
  if (query.merchantId) and.push({ offers: { some: { ...publicOfferWhere, merchantId: query.merchantId } } });
  else and.push({ offers: { some: publicOfferWhere } });
  where.AND = and;
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, include: productInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: query.limit, skip: query.offset }),
  ]);
  return { total, items: rows.map(presentProduct) };
}

export async function getProductDetail(id: string) {
  const p = await prisma.product.findFirst({ where: { id, status: 'ACTIVE' }, include: productInclude });
  if (!p) throw notFound('Product');
  const product = presentProduct(p);
  const sellers = await presentSellers([...new Set(product.offers.map((o) => o.sellerId))]);
  return { product, sellers };
}

/** Full public catalog for the app's local cache (Phase 1 scale: hundreds to low thousands of SKUs). */
export async function catalogSnapshot() {
  const rows = await prisma.product.findMany({ where: { status: 'ACTIVE', offers: { some: publicOfferWhere } }, include: productInclude, orderBy: { createdAt: 'asc' } });
  const products = rows.map(presentProduct);
  const sellers = await presentSellers([...new Set(products.flatMap((p) => p.offers.map((o) => o.sellerId)))]);
  return { generatedAt: new Date().toISOString(), products, sellers };
}

/** Public live price/stock lookup: private offers are excluded (the owner reads them via /v1/me/private-offers). */
export async function offersByIds(ids: string[]) {
  const rows = await prisma.offer.findMany({ where: { id: { in: ids }, visibility: 'PUBLIC' }, include: { ...offerInclude, merchant: true } });
  return rows.map((o) => ({ ...presentOffer(o), purchasable: o.status === 'ACTIVE' && o.merchant.status === 'APPROVED' && o.location.active }));
}

export async function referenceData() {
  const [categories, makes] = await Promise.all([
    prisma.category.findMany({ orderBy: { sort: 'asc' } }),
    prisma.vehicleMake.findMany({ include: { models: { orderBy: { nameEn: 'asc' } } }, orderBy: { nameEn: 'asc' } }),
  ]);
  return {
    categories: categories.map((c) => ({ id: c.id, name: { ar: c.nameAr, en: c.nameEn }, art: c.art })),
    makes: makes.map((m) => ({
      id: m.id,
      name: { ar: m.nameAr, en: m.nameEn },
      models: m.models.map((x) => ({ id: x.id, makeId: m.id, name: { ar: x.nameAr, en: x.nameEn }, yearFrom: x.yearFrom, yearTo: x.yearTo, trims: x.trims, engines: x.engines })),
    })),
  };
}
