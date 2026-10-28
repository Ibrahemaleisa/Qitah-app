import { Prisma } from '@prisma/client';

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

/** Public listing filter. PRIVATE offers (accepted part-request quotes) never appear in catalog, search, snapshot or seller pages. */
export const publicOfferWhere: Prisma.OfferWhereInput = {
  visibility: 'PUBLIC',
  status: 'ACTIVE',
  merchant: { status: 'APPROVED' },
  location: { active: true },
};

export const offerInclude = { inventory: true, location: true } satisfies Prisma.OfferInclude;
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

/**
 * DEPRECATED full-catalog dump (`GET /v1/catalog/snapshot`), kept for old app builds only. Capped at
 * `limit` listed products (oldest first) and driven by the ProductListing read model instead of an
 * `offers: { some }` join. Current apps hydrate on demand: reference + home + products?ids + changes.
 */
export async function catalogSnapshot(limit: number) {
  const listed = await prisma.$queryRaw<{ productId: string }[]>`
    SELECT pl."productId" FROM "ProductListing" pl JOIN "Product" p ON p.id = pl."productId"
    WHERE pl.listed AND p.status = 'ACTIVE' ORDER BY p."createdAt" ASC, p.id ASC LIMIT ${limit + 1}`;
  const ids = listed.slice(0, limit).map((r) => r.productId);
  const rows = ids.length ? await prisma.product.findMany({ where: { id: { in: ids }, status: 'ACTIVE' }, include: productInclude, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }) : [];
  const products = rows.map(presentProduct);
  const sellers = await presentSellers([...new Set(products.flatMap((p) => p.offers.map((o) => o.sellerId)))]);
  return { generatedAt: new Date().toISOString(), deprecated: true, truncated: listed.length > limit, limit, products, sellers };
}

/**
 * Batch product lookup (favorites, recently viewed, cart, private-offer products…). ACTIVE products in
 * the order asked, each with its PUBLIC offers (possibly none: the app then shows "unavailable"), plus the
 * sellers of those offers. Unknown / inactive ids are reported in `missing`.
 */
export async function productsByIds(ids: string[]) {
  const unique = [...new Set(ids)];
  const rows = unique.length ? await prisma.product.findMany({ where: { id: { in: unique }, status: 'ACTIVE' }, include: productInclude }) : [];
  const byId = new Map(rows.map((r) => [r.id, presentProduct(r)]));
  const products = unique.flatMap((id) => {
    const p = byId.get(id);
    return p ? [p] : [];
  });
  const sellers = await presentSellers([...new Set(products.flatMap((p) => p.offers.map((o) => o.sellerId)))]);
  return { products, sellers, missing: unique.filter((id) => !byId.has(id)) };
}

/** Product ids behind PUBLIC offers (a cart only stores offer ids). Private offers resolve via /v1/me/private-offers. */
export async function productIdsForOffers(offerIds: string[]) {
  if (!offerIds.length) return [];
  const rows = await prisma.offer.findMany({ where: { id: { in: [...new Set(offerIds)] }, visibility: 'PUBLIC' }, select: { productId: true } });
  return [...new Set(rows.map((r) => r.productId))];
}

export type HomeVehicle = { modelId?: string; year?: number; engine?: string };

/**
 * Per-vehicle "starter pack" for the home screen (replaces the app's hard-coded featured ids), bounded by `limit`.
 * - `recommended`: in-stock products with CATALOG-verified fitment for the vehicle (engine-restricted fitment only
 *   counts when the engine matches, like search), at most 3 per category so one category cannot fill the pack.
 * - `featured`: the most-offered in-stock products per category. With a vehicle only by-specification (universal)
 *   products are featured, so the pack never suggests a part that is not known to fit.
 */
export async function homeStarterPack(v: HomeVehicle, limit = 24) {
  const recLimit = Math.ceil((limit * 2) / 3);
  let recommended: string[] = [];
  if (v.modelId) {
    const engine = v.engine ? Prisma.sql`(cardinality(f.engines) = 0 OR ${v.engine} = ANY(f.engines))` : Prisma.sql`cardinality(f.engines) = 0`;
    const scope = v.year !== undefined ? Prisma.sql`AND ${v.year}::int BETWEEN f."yearFrom" AND f."yearTo" AND ${engine}` : Prisma.empty;
    const rows = await prisma.$queryRaw<{ productId: string }[]>`
      WITH fit AS (
        SELECT DISTINCT f."productId" FROM "ProductFitment" f
        WHERE f."modelId" = ${v.modelId} AND f.source = 'CATALOG' ${scope}
      ), ranked AS (
        SELECT pl."productId", pl."categoryId", pl."inStockOfferCount", pl."totalAvailable",
          row_number() OVER (PARTITION BY pl."categoryId" ORDER BY pl."inStockOfferCount" DESC, pl."totalAvailable" DESC, pl."productId") AS rn
        FROM fit JOIN "ProductListing" pl ON pl."productId" = fit."productId"
        WHERE pl.listed AND pl."inStockOfferCount" > 0
      )
      SELECT "productId" FROM ranked WHERE rn <= 3
      ORDER BY rn, "inStockOfferCount" DESC, "totalAvailable" DESC, "productId" LIMIT ${recLimit}`;
    recommended = rows.map((r) => r.productId);
  }
  const universalOnly = v.modelId ? Prisma.sql`AND pl.universal` : Prisma.empty;
  const featuredRows = await prisma.$queryRaw<{ productId: string }[]>`
    SELECT x."productId" FROM "Category" c CROSS JOIN LATERAL (
      SELECT pl."productId", pl."offerCount" FROM "ProductListing" pl
      WHERE pl.listed AND pl."categoryId" = c.id AND pl."inStockOfferCount" > 0 ${universalOnly}
      ORDER BY pl."offerCount" DESC, pl."productId" LIMIT 2
    ) x ORDER BY c.sort, x."offerCount" DESC, x."productId"`;
  const taken = new Set(recommended);
  const featured = featuredRows.map((r) => r.productId).filter((id) => !taken.has(id)).slice(0, Math.max(0, limit - recommended.length));
  const { products, sellers } = await productsByIds([...recommended, ...featured]);
  return { vehicle: v.modelId ? { modelId: v.modelId, year: v.year ?? null, engine: v.engine ?? null } : null, recommended, featured, products, sellers };
}

/**
 * Deltas for products a client has cached: every product among `ids` whose product row or listing
 * (any public offer's price, stock, status, terms; seller visibility) changed after `since`, in full;
 * plus `removed` for ids that are no longer active. `serverTime` is read BEFORE querying so the next
 * call (since = serverTime) cannot miss a change committed meanwhile.
 */
export async function catalogChanges(since: Date, ids: string[]) {
  const serverTime = new Date();
  const unique = [...new Set(ids)];
  if (!unique.length) return { serverTime: serverTime.toISOString(), since: since.toISOString(), products: [], sellers: [], removed: [] };
  const rows = await prisma.$queryRaw<{ id: string; status: string }[]>`
    SELECT p.id, p.status::text AS status FROM "Product" p LEFT JOIN "ProductListing" pl ON pl."productId" = p.id
    WHERE p.id = ANY(${unique}) AND (p."updatedAt" > ${since} OR pl."updatedAt" > ${since} OR p.status <> 'ACTIVE')`;
  const known = new Set((await prisma.product.findMany({ where: { id: { in: unique } }, select: { id: true } })).map((r) => r.id));
  const changed = rows.filter((r) => r.status === 'ACTIVE').map((r) => r.id);
  const { products, sellers } = await productsByIds(changed);
  const removed = [...rows.filter((r) => r.status !== 'ACTIVE').map((r) => r.id), ...unique.filter((id) => !known.has(id))];
  return { serverTime: serverTime.toISOString(), since: since.toISOString(), products, sellers, removed };
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
