import { createHash } from 'node:crypto';

import { Prisma, type Condition } from '@prisma/client';

import { prisma, type Db } from '../db.js';
import { offerInclude, presentOffer, publicOfferWhere } from './catalog.js';

/**
 * ProductListing read model (one row per product; see the "catalog read model" block in schema.prisma).
 *
 * Everything here is derived from offers that pass `publicOfferWhere`, read through Prisma with that
 * exact where-clause, so the read model can never disagree with what the public catalog shows (freshness
 * or quality rules added to `publicOfferWhere` flow in automatically).
 *
 * Write paths call `refreshListings(tx, productIds)` (or `refreshListingsForOffers`) in the SAME
 * transaction as the offer / stock / merchant / location change. The upsert only writes when a derived
 * value changed, so `updatedAt` is a reliable "something a client caches changed" clock for
 * `/v1/catalog/changes`. Ids are sorted so concurrent transactions lock listing rows in one order.
 * Safety net: `sweepListings` (worker) and `npm run db:backfill-listings` (scripts/backfill-listings.ts).
 */

/** Compact per-offer summary kept in ProductListing.offers (searches filtered by condition / merchant). */
export type ListingOffer = { id: string; m: string; c: string; p: number; a: number; d: number };

const CONDITIONS: Condition[] = ['NEW', 'USED', 'REFURBISHED'];
const BATCH = 500;

type ListingRow = {
  productId: string;
  status: string;
  listed: boolean;
  categoryId: string;
  brand: string;
  origin: string;
  universal: boolean;
  hasCatalogFitment: boolean;
  offerCount: number;
  inStockOfferCount: number;
  totalAvailable: number;
  minPriceHalalas: number | null;
  minOfferPriceHalalas: number | null;
  minInStockPriceHalalas: number | null;
  minDispatchDays: number | null;
  minInStockDispatchDays: number | null;
  conditions: Condition[];
  inStockConditions: Condition[];
  merchantIds: string[];
  originCities: string[];
  offers: ListingOffer[];
  offersHash: string;
  catalogFitKeys: string[];
  sellerFitKeys: string[];
};

/**
 * Exploded fitment keys (by source) so "does this product fit the vehicle?" is one GIN-indexable array
 * overlap on the listing row instead of an EXISTS over ProductFitment per candidate. Mirrors the search
 * rules exactly (see `vehicleFitKeys`): an engine-restricted fitment only matches when the engine is known.
 *   m|<model>                 any fitment for the model (model scope)
 *   k|<make>                  any fitment for a model of the make (make scope)
 *   y|<model>|<year>          a fitment for that year with no engine restriction
 *   e|<model>|<year>|<engine> a fitment for that year restricted to engines including <engine>
 */
export function fitKeys(rows: { modelId: string; makeId: string; yearFrom: number; yearTo: number; engines: string[] }[]): string[] {
  const keys = new Set<string>();
  for (const f of rows) {
    keys.add(`m|${f.modelId}`);
    keys.add(`k|${f.makeId}`);
    for (let y = f.yearFrom; y <= f.yearTo && y - f.yearFrom < 100; y++) {
      if (!f.engines.length) keys.add(`y|${f.modelId}|${y}`);
      else for (const e of f.engines) keys.add(`e|${f.modelId}|${y}|${e}`);
    }
  }
  return [...keys].sort();
}

/** The keys a vehicle (as resolved by search) matches: overlap with a product's keys ⇔ the old EXISTS rule. */
export function vehicleFitKeys(v: { scope: 'vehicle' | 'model' | 'make'; makeId?: string; modelId?: string; year?: number; engine?: string }): string[] {
  if (v.scope === 'vehicle' && v.modelId && v.year !== undefined) return v.engine ? [`y|${v.modelId}|${v.year}`, `e|${v.modelId}|${v.year}|${v.engine}`] : [`y|${v.modelId}|${v.year}`];
  if (v.modelId) return [`m|${v.modelId}`];
  return [`k|${v.makeId ?? ''}`];
}

const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const ordered = <T extends string>(set: Set<T>, order: readonly T[]) => order.filter((x) => set.has(x));

async function computeRows(db: Db, ids: string[]): Promise<{ rows: ListingRow[]; missing: string[] }> {
  const products = await db.product.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      status: true,
      categoryId: true,
      brand: true,
      origin: true,
      universalNoteAr: true,
      fitments: { select: { modelId: true, yearFrom: true, yearTo: true, engines: true, source: true, model: { select: { makeId: true } } } },
    },
  });
  const offers = await db.offer.findMany({ where: { productId: { in: ids }, ...publicOfferWhere }, include: offerInclude, orderBy: { id: 'asc' } });
  const byProduct = new Map<string, typeof offers>();
  for (const o of offers) {
    const list = byProduct.get(o.productId);
    if (list) list.push(o);
    else byProduct.set(o.productId, [o]);
  }
  const found = new Set(products.map((p) => p.id));
  const rows = products.map((p): ListingRow => {
    const list = byProduct.get(p.id) ?? [];
    const presented = list.map(presentOffer);
    const inStock = presented.filter((o) => o.available > 0);
    const conditions = new Set(list.map((o) => o.condition));
    const inStockConditions = new Set(list.filter((_, i) => presented[i].available > 0).map((o) => o.condition));
    const minInStock = min(inStock.map((o) => o.priceHalalas));
    const minAny = min(presented.map((o) => o.priceHalalas));
    return {
      productId: p.id,
      status: p.status,
      listed: p.status === 'ACTIVE' && list.length > 0,
      categoryId: p.categoryId,
      brand: p.brand,
      origin: p.origin,
      universal: p.universalNoteAr != null,
      hasCatalogFitment: p.fitments.some((f) => f.source === 'CATALOG'),
      catalogFitKeys: fitKeys(p.fitments.filter((f) => f.source === 'CATALOG').map((f) => ({ ...f, makeId: f.model.makeId }))),
      sellerFitKeys: fitKeys(p.fitments.filter((f) => f.source === 'SELLER').map((f) => ({ ...f, makeId: f.model.makeId }))),
      offerCount: list.length,
      inStockOfferCount: inStock.length,
      totalAvailable: presented.reduce((s, o) => s + o.available, 0),
      minPriceHalalas: minInStock ?? minAny,
      minOfferPriceHalalas: minAny,
      minInStockPriceHalalas: minInStock,
      minDispatchDays: min(presented.map((o) => o.dispatchDays[0])),
      minInStockDispatchDays: min(inStock.map((o) => o.dispatchDays[0])),
      conditions: ordered(conditions, CONDITIONS),
      inStockConditions: ordered(inStockConditions, CONDITIONS),
      merchantIds: [...new Set(list.map((o) => o.merchantId))].sort(),
      originCities: [...new Set(list.map((o) => o.location.city))].sort(),
      offers: presented.map((o) => ({ id: o.id, m: o.sellerId, c: o.condition, p: o.priceHalalas, a: o.available, d: o.dispatchDays[0] })),
      offersHash: presented.length ? createHash('md5').update(JSON.stringify(presented)).digest('hex') : '',
    };
  });
  return { rows, missing: ids.filter((id) => !found.has(id)) };
}

function upsertSql(rows: ListingRow[]) {
  const values = rows.map(
    (r) => Prisma.sql`(${r.productId}, ${r.status}::"ProductStatus", ${r.listed}, ${r.categoryId}, ${r.brand}, ${r.origin}::"PartOrigin", ${r.universal}, ${r.hasCatalogFitment},
      ${r.offerCount}, ${r.inStockOfferCount}, ${r.totalAvailable}, ${r.minPriceHalalas}::int, ${r.minOfferPriceHalalas}::int, ${r.minInStockPriceHalalas}::int,
      ${r.minDispatchDays}::int, ${r.minInStockDispatchDays}::int, ${r.conditions}::"Condition"[], ${r.inStockConditions}::"Condition"[], ${r.merchantIds}::text[],
      ${r.originCities}::text[], ${JSON.stringify(r.offers)}::jsonb, ${r.offersHash}, ${r.catalogFitKeys}::text[], ${r.sellerFitKeys}::text[], now())`,
  );
  // Every derived column; the WHERE makes an unchanged row a no-op (no write, no updatedAt bump).
  return Prisma.sql`
    INSERT INTO "ProductListing" ("productId", "status", "listed", "categoryId", "brand", "origin", "universal", "hasCatalogFitment",
      "offerCount", "inStockOfferCount", "totalAvailable", "minPriceHalalas", "minOfferPriceHalalas", "minInStockPriceHalalas",
      "minDispatchDays", "minInStockDispatchDays", "conditions", "inStockConditions", "merchantIds", "originCities", "offers", "offersHash", "catalogFitKeys", "sellerFitKeys", "updatedAt")
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("productId") DO UPDATE SET
      "status" = EXCLUDED."status", "listed" = EXCLUDED."listed", "categoryId" = EXCLUDED."categoryId", "brand" = EXCLUDED."brand",
      "origin" = EXCLUDED."origin", "universal" = EXCLUDED."universal", "hasCatalogFitment" = EXCLUDED."hasCatalogFitment",
      "offerCount" = EXCLUDED."offerCount", "inStockOfferCount" = EXCLUDED."inStockOfferCount", "totalAvailable" = EXCLUDED."totalAvailable",
      "minPriceHalalas" = EXCLUDED."minPriceHalalas", "minOfferPriceHalalas" = EXCLUDED."minOfferPriceHalalas",
      "minInStockPriceHalalas" = EXCLUDED."minInStockPriceHalalas", "minDispatchDays" = EXCLUDED."minDispatchDays",
      "minInStockDispatchDays" = EXCLUDED."minInStockDispatchDays", "conditions" = EXCLUDED."conditions",
      "inStockConditions" = EXCLUDED."inStockConditions", "merchantIds" = EXCLUDED."merchantIds", "originCities" = EXCLUDED."originCities",
      "offers" = EXCLUDED."offers", "offersHash" = EXCLUDED."offersHash", "catalogFitKeys" = EXCLUDED."catalogFitKeys",
      "sellerFitKeys" = EXCLUDED."sellerFitKeys", "updatedAt" = now()
    WHERE ("ProductListing"."status", "ProductListing"."listed", "ProductListing"."categoryId", "ProductListing"."brand", "ProductListing"."origin",
           "ProductListing"."universal", "ProductListing"."hasCatalogFitment", "ProductListing"."offerCount", "ProductListing"."inStockOfferCount",
           "ProductListing"."totalAvailable", "ProductListing"."minPriceHalalas", "ProductListing"."minOfferPriceHalalas",
           "ProductListing"."minInStockPriceHalalas", "ProductListing"."minDispatchDays", "ProductListing"."minInStockDispatchDays",
           "ProductListing"."conditions", "ProductListing"."inStockConditions", "ProductListing"."merchantIds", "ProductListing"."originCities",
           "ProductListing"."offersHash", "ProductListing"."catalogFitKeys", "ProductListing"."sellerFitKeys")
      IS DISTINCT FROM
          (EXCLUDED."status", EXCLUDED."listed", EXCLUDED."categoryId", EXCLUDED."brand", EXCLUDED."origin", EXCLUDED."universal",
           EXCLUDED."hasCatalogFitment", EXCLUDED."offerCount", EXCLUDED."inStockOfferCount", EXCLUDED."totalAvailable", EXCLUDED."minPriceHalalas",
           EXCLUDED."minOfferPriceHalalas", EXCLUDED."minInStockPriceHalalas", EXCLUDED."minDispatchDays", EXCLUDED."minInStockDispatchDays",
           EXCLUDED."conditions", EXCLUDED."inStockConditions", EXCLUDED."merchantIds", EXCLUDED."originCities", EXCLUDED."offersHash",
           EXCLUDED."catalogFitKeys", EXCLUDED."sellerFitKeys")
    RETURNING "productId"`;
}

/**
 * Recomputes the listing rows of these products (batched, sorted). Returns how many rows changed.
 * Products that no longer exist lose their row.
 */
export async function refreshListings(db: Db, productIds: Iterable<string>): Promise<number> {
  const ids = [...new Set(productIds)].filter(Boolean).sort();
  let changed = 0;
  for (let i = 0; i < ids.length; i += BATCH) {
    const slice = ids.slice(i, i + BATCH);
    // Outside a transaction, each batch gets its own so the row locks below cover read + write.
    changed += db === prisma ? await prisma.$transaction((tx) => refreshBatch(tx, slice), { timeout: 60_000 }) : await refreshBatch(db, slice);
  }
  return changed;
}

/**
 * Lock first, then read: the listing rows are locked (in id order) BEFORE the offers are read, so under
 * READ COMMITTED a concurrent transaction that changed another offer of the same product has committed
 * by the time we read, and neither transaction can overwrite the other's change with a stale aggregate.
 * Products without a row get a placeholder first so the same lock exists for them too.
 */
async function refreshBatch(db: Db, ids: string[]) {
  const changed = new Set<string>();
  const locked = await db.$queryRaw<{ productId: string }[]>`
    SELECT "productId" FROM "ProductListing" WHERE "productId" = ANY(${ids}) ORDER BY "productId" FOR UPDATE`;
  if (locked.length < ids.length) {
    const have = new Set(locked.map((r) => r.productId));
    const absent = ids.filter((id) => !have.has(id));
    const inserted = await db.$queryRaw<{ productId: string }[]>`
      INSERT INTO "ProductListing" ("productId", "status", "categoryId", "brand", "origin", "conditions", "inStockConditions", "merchantIds", "originCities", "updatedAt")
      SELECT id, status, "categoryId", brand, origin, '{}', '{}', '{}', '{}', now() FROM "Product" WHERE id = ANY(${absent}) ORDER BY id
      ON CONFLICT ("productId") DO NOTHING RETURNING "productId"`;
    for (const r of inserted) changed.add(r.productId);
    await db.$queryRaw`SELECT "productId" FROM "ProductListing" WHERE "productId" = ANY(${absent}) ORDER BY "productId" FOR UPDATE`;
  }
  const { rows, missing } = await computeRows(db, ids);
  if (rows.length) for (const r of await db.$queryRaw<{ productId: string }[]>(upsertSql(rows))) changed.add(r.productId);
  if (missing.length) {
    for (const r of await db.$queryRaw<{ productId: string }[]>`DELETE FROM "ProductListing" WHERE "productId" = ANY(${missing}) RETURNING "productId"`) changed.add(r.productId);
  }
  return changed.size;
}

/** One product. The name the write paths read best with. */
export function refreshListing(db: Db, productId: string) {
  return refreshListings(db, [productId]);
}

/** Refreshes the products these offers belong to (inventory paths only know offer ids). */
export async function refreshListingsForOffers(db: Db, offerIds: Iterable<string>) {
  const ids = [...new Set(offerIds)];
  if (!ids.length) return 0;
  const rows = await db.offer.findMany({ where: { id: { in: ids } }, select: { productId: true } });
  return refreshListings(db, rows.map((r) => r.productId));
}

/** Every product a merchant offers (merchant status change). */
export async function refreshListingsForMerchant(db: Db, merchantId: string) {
  const rows = await db.offer.findMany({ where: { merchantId }, select: { productId: true }, distinct: ['productId'] });
  return refreshListings(db, rows.map((r) => r.productId));
}

/** Every product offered from a pickup location (location activated / deactivated). */
export async function refreshListingsForLocation(db: Db, locationId: string) {
  const rows = await db.offer.findMany({ where: { locationId }, select: { productId: true }, distinct: ['productId'] });
  return refreshListings(db, rows.map((r) => r.productId));
}

/**
 * Rebuilds every listing in id order (backfill script, seed). Idempotent: a second run changes nothing.
 * `onBatch` reports progress.
 */
export async function rebuildAllListings(opts: { batch?: number; onBatch?: (scanned: number, changed: number) => void } = {}) {
  const batch = opts.batch ?? 1000;
  let cursor = '';
  let scanned = 0;
  let changed = 0;
  for (;;) {
    const rows = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE id > ${cursor} ORDER BY id LIMIT ${batch}`;
    if (!rows.length) break;
    changed += await refreshListings(prisma, rows.map((r) => r.id));
    scanned += rows.length;
    cursor = rows[rows.length - 1].id;
    opts.onBatch?.(scanned, changed);
  }
  // Rows whose product was deleted.
  changed += await prisma.$executeRaw`DELETE FROM "ProductListing" pl WHERE NOT EXISTS (SELECT 1 FROM "Product" p WHERE p.id = pl."productId")`;
  return { scanned, changed };
}

/**
 * Worker safety net: each call re-derives the next slice of products (cycling through the catalog) plus
 * any product that has no listing row yet. Catches drift from paths outside the services (manual SQL)
 * and time-based visibility rules (offer freshness) that change with no write at all.
 */
let sweepCursor = '';
export async function sweepListings(opts: { slice?: number } = {}) {
  const slice = opts.slice ?? 2000;
  const missing = await prisma.$queryRaw<{ id: string }[]>`
    SELECT p.id FROM "Product" p LEFT JOIN "ProductListing" pl ON pl."productId" = p.id WHERE pl."productId" IS NULL LIMIT ${slice}`;
  const next = await prisma.$queryRaw<{ id: string }[]>`SELECT id FROM "Product" WHERE id > ${sweepCursor} ORDER BY id LIMIT ${slice}`;
  sweepCursor = next.length < slice ? '' : next[next.length - 1].id;
  return refreshListings(prisma, [...missing, ...next].map((r) => r.id));
}

export function resetSweepCursor() {
  sweepCursor = '';
}
