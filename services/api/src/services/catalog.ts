import type { Prisma } from '@prisma/client';

import { prisma, type Db } from '../db.js';
import { notFound } from '../lib/errors.js';
import { normalizePartNumber, normalizeText } from '../lib/text.js';
import { conceptSearchTerms, productConcepts } from '../search/lexicon.js';

/**
 * Builds the normalised search text stored on Product (GIN trigram-indexed, see *_search_indexes).
 * Besides names, brand, keywords, category names and part numbers it carries the lexicon's concept
 * tokens ("{brakepads}") and every colloquial surface form of those concepts, so "هوبات" or "قربة"
 * find a product even when its own keywords never say so.
 */
export function buildSearchText(p: {
  nameAr: string;
  nameEn: string;
  brand: string;
  keywords: string[];
  partNumber: string;
  identifiers?: string[];
  categoryNames?: string[];
  categoryId?: string;
  art?: string | null;
}) {
  const parts = [p.nameAr, p.nameEn, p.brand, ...p.keywords, ...(p.categoryNames ?? [])].map(normalizeText);
  // Sorted so the seed (which passes OEM references) and refreshSearchText (identifier rows) agree byte for byte.
  const numbers = [...new Set([p.partNumber, ...(p.identifiers ?? [])].map(normalizePartNumber))].sort();
  const concepts = conceptSearchTerms(productConcepts({ nameAr: p.nameAr, nameEn: p.nameEn, categoryId: p.categoryId ?? '', art: p.art, keywords: p.keywords }));
  return [...new Set([...parts, ...numbers, ...concepts].filter(Boolean))].join(' ');
}

/** Recomputes Product.searchText; returns true when it changed. */
export async function refreshSearchText(db: Db, productId: string) {
  const p = await db.product.findUniqueOrThrow({ where: { id: productId }, include: { identifiers: true, category: true } });
  const searchText = buildSearchText({
    ...p,
    identifiers: p.identifiers.map((i) => i.value),
    categoryNames: [p.category.nameAr, p.category.nameEn],
  });
  if (searchText === p.searchText) return false;
  await db.product.update({ where: { id: productId }, data: { searchText } });
  return true;
}

export const publicOfferWhere: Prisma.OfferWhereInput = {
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

export const productInclude = {
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

/** Product search lives in ./search.ts (`searchProducts`, and `searchCatalog` for the legacy list endpoint). */

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

export async function offersByIds(ids: string[]) {
  const rows = await prisma.offer.findMany({ where: { id: { in: ids } }, include: { ...offerInclude, merchant: true } });
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
