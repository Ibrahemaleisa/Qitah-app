import { Prisma } from '@prisma/client';

import { prisma } from '../db.js';
import { badRequest } from '../lib/errors.js';
import {
  analyzeQuery,
  conceptToken,
  getConcept,
  resolveVehicle,
  stripVehicleFromQuery,
  suggestCorrection,
  tokenVariants,
  type GarageVehicleRef,
  type LexMake,
  type QueryAnalysis,
  type ResolvedVehicle,
} from '../search/lexicon.js';
import { presentProduct, productInclude } from './catalog.js';

/**
 * Relevance-ranked product search (`GET /v1/catalog/search`, also behind `/v1/catalog/products`).
 *
 * Matching: a product is a candidate when it matches a part number in the query, OR it carries every
 * concept the query names (via the "{concept}" tokens in Product.searchText) and contains every remaining
 * free word (or its light stem). A query that names only a vehicle ("كامري 2022") browses that vehicle.
 * When nothing matches: try a one-edit spelling correction from the lexicon, then drop the free words,
 * then fall back to trigram similarity. Concepts Qitah doesn't carry (tires…) skip the fuzzy fallbacks
 * and are reported in `interpretation.unsupported` so the app can offer "request this part".
 *
 * Ranking (descending): exact manufacturer part number > exact OEM reference > prefix > contained; then fits-group
 * (when a vehicle is known, so "fit not confirmed" items sit below a divider rather than mixed in);
 * concept matches; trigram similarity (bucketed); fitment tier catalog > seller > by specification;
 * raw similarity; id. Paging is keyset over (k1, k2, id) and also accepts a legacy offset.
 *
 * Indexes (migration *_search_indexes): GIN pg_trgm on Product.searchText serves every LIKE '%…%' and
 * word_similarity; btree text_pattern_ops on ProductIdentifier.normalized serves part-number prefixes.
 */

export type SortKey = 'relevance' | 'priceAsc' | 'priceDesc' | 'fastest';
export type FitLabel = 'catalogMatch' | 'sellerReported' | 'bySpecification' | 'noData' | 'noVehicle' | 'listedForModel' | 'listedForMake';

export type SearchParams = {
  q?: string;
  categoryId?: string;
  modelId?: string;
  year?: number;
  engine?: string;
  fitsOnly?: boolean;
  origins?: ('oem' | 'aftermarket')[];
  conditions?: ('new' | 'used' | 'refurbished')[];
  inStock?: boolean;
  sort?: SortKey;
  merchantId?: string;
  cursor?: string;
  offset?: number;
  limit: number;
};

// ───────────────────────────────────────────── reference data (vehicle names for query parsing)

let reference: { at: number; makes: LexMake[] } | null = null;
const REFERENCE_TTL_MS = 60_000;

export async function searchReference(): Promise<LexMake[]> {
  if (reference && Date.now() - reference.at < REFERENCE_TTL_MS) return reference.makes;
  const makes = await prisma.vehicleMake.findMany({ include: { models: true }, orderBy: { id: 'asc' } });
  reference = {
    at: Date.now(),
    makes: makes.map((m) => ({
      id: m.id,
      name: { ar: m.nameAr, en: m.nameEn },
      models: m.models.map((x) => ({ id: x.id, makeId: m.id, name: { ar: x.nameAr, en: x.nameEn }, yearFrom: x.yearFrom, yearTo: x.yearTo })),
    })),
  };
  return reference.makes;
}

export function invalidateSearchReference() {
  reference = null;
}

// ───────────────────────────────────────────── cursor

type Cursor = { k1: string; k2: string; id: string };

function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify([c.k1, c.k2, c.id])).toString('base64url');
}

function decodeCursor(raw: string): Cursor {
  try {
    const [k1, k2, id] = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as unknown[];
    if (typeof k1 === 'string' && typeof k2 === 'string' && typeof id === 'string' && /^-?\d+$/.test(k1) && /^-?\d+$/.test(k2) && id.length <= 64) return { k1, k2, id };
  } catch {
    // fall through
  }
  throw badRequest('INVALID_CURSOR', 'The paging cursor is invalid or expired');
}

// ───────────────────────────────────────────── SQL building

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
const contains = (s: string) => `%${escapeLike(s)}%`;
const anyOf = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`(${Prisma.join(parts, ' OR ')})` : Prisma.sql`FALSE`);
const allOf = (parts: Prisma.Sql[]) => (parts.length ? Prisma.sql`(${Prisma.join(parts, ' AND ')})` : Prisma.sql`TRUE`);

type Criteria = { groups: string[][]; free: string[]; partNumbers: string[]; simText: string; fuzzy: boolean };

function criteriaFrom(a: QueryAnalysis): Criteria {
  const partNumbers = a.partNumber ? [a.partNumber] : a.partNumbers;
  const simText = [...a.concepts.map((c) => c.term), ...a.freeTokens].join(' ') || (a.partNumber ?? '');
  return { groups: a.conceptGroups, free: a.freeTokens, partNumbers, simText, fuzzy: false };
}

function fitmentExists(v: ResolvedVehicle, source: 'CATALOG' | 'SELLER'): Prisma.Sql {
  const src = source === 'CATALOG' ? Prisma.sql`f.source = 'CATALOG'` : Prisma.sql`f.source = 'SELLER'`;
  let scope: Prisma.Sql;
  if (v.scope === 'vehicle' && v.modelId && v.year !== undefined) {
    // Unknown engine: an engine-restricted fitment is not a confirmed fit.
    const engine = v.engine ? Prisma.sql`(cardinality(f.engines) = 0 OR ${v.engine} = ANY(f.engines))` : Prisma.sql`cardinality(f.engines) = 0`;
    scope = Prisma.sql`f."modelId" = ${v.modelId} AND ${v.year}::int BETWEEN f."yearFrom" AND f."yearTo" AND ${engine}`;
  } else if (v.modelId) {
    scope = Prisma.sql`f."modelId" = ${v.modelId}`;
  } else {
    scope = Prisma.sql`f."modelId" IN (SELECT vm.id FROM "VehicleModel" vm WHERE vm."makeId" = ${v.makeId ?? ''})`;
  }
  return Prisma.sql`EXISTS (SELECT 1 FROM "ProductFitment" f WHERE f."productId" = p.id AND ${src} AND ${scope})`;
}

function tierSql(v: ResolvedVehicle | null): Prisma.Sql {
  if (!v) return Prisma.sql`CASE WHEN p."universalNoteAr" IS NOT NULL THEN 2 ELSE 3 END`;
  return Prisma.sql`CASE WHEN ${fitmentExists(v, 'CATALOG')} THEN 0 WHEN ${fitmentExists(v, 'SELLER')} THEN 1 WHEN p."universalNoteAr" IS NOT NULL THEN 2 ELSE 3 END`;
}

function scoredCte(params: SearchParams, c: Criteria, vehicle: ResolvedVehicle | null): Prisma.Sql {
  const pnContains = c.partNumbers.filter((pn) => pn.length >= 4).map((pn) => Prisma.sql`p."searchText" LIKE ${contains(pn)}`);
  const conceptHit = c.groups.map((g) => anyOf(g.map((id) => Prisma.sql`p."searchText" LIKE ${contains(conceptToken(id))}`)));
  const freeHit = c.free.map((t) => anyOf(tokenVariants(t).map((v) => Prisma.sql`p."searchText" LIKE ${contains(v)}`)));

  let match: Prisma.Sql;
  if (c.fuzzy) match = Prisma.sql`word_similarity(${c.simText}, p."searchText") >= 0.4`;
  else {
    const textMatch = c.groups.length || c.free.length ? allOf([...conceptHit, ...freeHit]) : c.partNumbers.length ? Prisma.sql`FALSE` : Prisma.sql`TRUE`;
    match = c.partNumbers.length ? Prisma.sql`(ph."productId" IS NOT NULL OR ${anyOf(pnContains)} OR ${textMatch})` : textMatch;
  }

  const pnHits = c.partNumbers.length
    ? Prisma.sql`SELECT i."productId", max(CASE WHEN i.normalized = ANY(${c.partNumbers}) THEN (CASE WHEN i.type = 'MPN' THEN 4 ELSE 3 END) ELSE 2 END) AS pn
        FROM "ProductIdentifier" i
        WHERE i.normalized = ANY(${c.partNumbers}) OR ${anyOf(c.partNumbers.map((pn) => Prisma.sql`i.normalized LIKE ${`${escapeLike(pn)}%`}`))}
        GROUP BY i."productId"`
    : Prisma.sql`SELECT NULL::text AS "productId", 0 AS pn WHERE FALSE`;

  const offerFilters: Prisma.Sql[] = [Prisma.sql`o."productId" = p.id`, Prisma.sql`o.status = 'ACTIVE'`, Prisma.sql`m.status = 'APPROVED'`, Prisma.sql`l.active`];
  if (params.merchantId) offerFilters.push(Prisma.sql`o."merchantId" = ${params.merchantId}`);
  if (params.conditions?.length) offerFilters.push(Prisma.sql`lower(o.condition::text) = ANY(${params.conditions})`);
  if (params.inStock) offerFilters.push(Prisma.sql`COALESCE(inv."onHand" - inv.reserved, 0) > 0`);

  const productFilters: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`, match];
  if (params.categoryId) productFilters.push(Prisma.sql`p."categoryId" = ${params.categoryId}`);
  if (params.origins?.length) productFilters.push(Prisma.sql`lower(p.origin::text) = ANY(${params.origins})`);

  const sim = c.simText ? Prisma.sql`word_similarity(${c.simText}, p."searchText")` : Prisma.sql`0::real`;
  const ch = c.groups.length ? Prisma.sql`(${Prisma.join(conceptHit.map((h) => Prisma.sql`(CASE WHEN ${h} THEN 1 ELSE 0 END)`), ' + ')})` : Prisma.sql`0`;
  const pnTier = c.partNumbers.length ? Prisma.sql`COALESCE(ph.pn, CASE WHEN ${anyOf(pnContains)} THEN 1 ELSE 0 END)` : Prisma.sql`0`;
  const hasVehicle = vehicle ? 1 : 0;

  const k1 =
    params.sort === 'priceAsc'
      ? Prisma.sql`((1 - grp)::bigint * 10000000000 - price)`
      : params.sort === 'priceDesc'
        ? Prisma.sql`((1 - grp)::bigint * 10000000000 + price)`
        : params.sort === 'fastest'
          ? Prisma.sql`((1 - grp)::bigint * 10000000000 - dispatch)`
          : Prisma.sql`rel`;

  return Prisma.sql`
    pn_hits AS (${pnHits}),
    base AS (
      SELECT p.id, ${pnTier} AS pn, ${ch} AS ch, ${sim} AS sim, ${tierSql(vehicle)} AS tier, ofr.price, ofr.dispatch
      FROM "Product" p
      LEFT JOIN pn_hits ph ON ph."productId" = p.id
      JOIN LATERAL (
        SELECT min(o."priceHalalas")::bigint AS price, min(o."dispatchDaysMin")::bigint AS dispatch, count(*) AS n
        FROM "Offer" o
        JOIN "Merchant" m ON m.id = o."merchantId"
        JOIN "PickupLocation" l ON l.id = o."locationId"
        LEFT JOIN "InventoryLevel" inv ON inv."offerId" = o.id
        WHERE ${allOf(offerFilters)}
      ) ofr ON ofr.n > 0
      WHERE ${allOf(productFilters)}
    ),
    grouped AS (
      SELECT base.*, (CASE WHEN ${hasVehicle} = 1 AND tier = 3 THEN 1 ELSE 0 END) AS grp FROM base
    ),
    ranked AS (
      SELECT grouped.*,
        (pn::bigint * 1000000 + (1 - grp)::bigint * 100000 + LEAST(ch, 9)::bigint * 10000
          + floor(sim * 5)::bigint * 1000 + (3 - tier)::bigint * 100 + floor(sim * 99)::bigint) AS rel
      FROM grouped
    ),
    scored AS (SELECT ranked.*, ${k1} AS k1, rel AS k2 FROM ranked)`;
}

type Row = { id: string; pn: number; tier: number; grp: number; k1: bigint; k2: bigint };
type CountRow = { fits: bigint; other: bigint };

async function runQuery(params: SearchParams, c: Criteria, vehicle: ResolvedVehicle | null) {
  const cte = scoredCte(params, c, vehicle);
  const where: Prisma.Sql[] = [];
  if (params.fitsOnly && vehicle) where.push(Prisma.sql`grp = 0`);
  if (params.cursor) {
    const cur = decodeCursor(params.cursor);
    where.push(
      Prisma.sql`(k1 < ${cur.k1}::bigint OR (k1 = ${cur.k1}::bigint AND k2 < ${cur.k2}::bigint) OR (k1 = ${cur.k1}::bigint AND k2 = ${cur.k2}::bigint AND id > ${cur.id}))`,
    );
  }
  const offset = !params.cursor && params.offset ? Prisma.sql`OFFSET ${params.offset}` : Prisma.empty;
  const [rows, counts] = await Promise.all([
    prisma.$queryRaw<Row[]>`WITH ${cte}
      SELECT id, pn, tier, grp, k1, k2 FROM scored WHERE ${allOf(where)}
      ORDER BY k1 DESC, k2 DESC, id ASC LIMIT ${params.limit + 1} ${offset}`,
    prisma.$queryRaw<CountRow[]>`WITH ${cte}
      SELECT count(*) FILTER (WHERE grp = 0) AS fits, count(*) FILTER (WHERE grp = 1) AS other FROM scored`,
  ]);
  return { rows, fits: Number(counts[0]?.fits ?? 0), other: Number(counts[0]?.other ?? 0) };
}

function fitLabel(tier: number, vehicle: ResolvedVehicle | null): FitLabel {
  if (tier === 2) return 'bySpecification';
  if (!vehicle) return 'noVehicle';
  if (tier === 3) return 'noData';
  if (vehicle.scope === 'model') return 'listedForModel';
  if (vehicle.scope === 'make') return 'listedForMake';
  return tier === 0 ? 'catalogMatch' : 'sellerReported';
}

function vehicleLabel(v: ResolvedVehicle, makes: LexMake[]) {
  const make = makes.find((m) => m.id === v.makeId);
  const model = make?.models.find((x) => x.id === v.modelId);
  const year = v.year !== undefined ? ` ${v.year}` : '';
  if (model) return { ar: `${model.name.ar}${year}`, en: `${model.name.en}${year}` };
  if (make) return { ar: make.name.ar, en: make.name.en };
  return undefined;
}

// ───────────────────────────────────────────── public entry points

export async function searchProducts(params: SearchParams) {
  const makes = await searchReference();
  const analysis = analyzeQuery(params.q ?? '', makes);
  const garage: GarageVehicleRef | undefined = params.modelId && params.year ? { modelId: params.modelId, year: params.year, engine: params.engine } : undefined;
  let vehicle = resolveVehicle(analysis, garage, makes);
  if (!vehicle && params.modelId && !params.year) {
    const make = makes.find((m) => m.models.some((x) => x.id === params.modelId));
    if (make) vehicle = { source: 'garage', makeId: make.id, modelId: params.modelId, scope: 'model' };
  }

  const concepts = analysis.concepts.flatMap((span) =>
    span.conceptIds.map((id) => {
      const c = getConcept(id)!;
      return { id, label: c.label, categoryId: c.categoryId ?? null, carried: c.carried, term: span.term };
    }),
  );
  const unsupported = concepts.filter((c) => !c.carried).map(({ id, label }) => ({ id, label }));
  const onlyUnsupported = analysis.conceptGroups.length > 0 && analysis.conceptGroups.every((g) => g.every((id) => !getConcept(id)?.carried)) && !analysis.freeTokens.length && !analysis.partNumbers.length;

  const base = criteriaFrom(analysis);
  let result = await runQuery(params, base, vehicle);
  let fallback: { mode: 'corrected' | 'relaxed' | 'similar'; query?: string } | null = null;
  const didYouMean = suggestCorrection(analysis);
  const hasText = base.groups.length || base.free.length || base.partNumbers.length;

  if (result.fits + result.other === 0 && hasText && !onlyUnsupported && !params.cursor) {
    const attempts: { mode: 'corrected' | 'relaxed' | 'similar'; criteria: Criteria; query?: string }[] = [];
    if (didYouMean) attempts.push({ mode: 'corrected', criteria: criteriaFrom(analyzeQuery(didYouMean, makes)), query: didYouMean });
    if (base.groups.length && base.free.length) attempts.push({ mode: 'relaxed', criteria: { ...base, free: [] } });
    if (base.simText.length >= 3 && !analysis.partNumber) attempts.push({ mode: 'similar', criteria: { ...base, fuzzy: true } });
    for (const attempt of attempts) {
      const r = await runQuery(params, attempt.criteria, vehicle);
      if (r.fits + r.other > 0) {
        result = r;
        fallback = { mode: attempt.mode, ...(attempt.query ? { query: attempt.query } : {}) };
        break;
      }
    }
  }

  const page = result.rows.slice(0, params.limit);
  const last = result.rows.length > params.limit ? page[page.length - 1] : undefined;
  const products = page.length ? await prisma.product.findMany({ where: { id: { in: page.map((r) => r.id) } }, include: productInclude }) : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  const items = page.flatMap((r) => {
    const p = byId.get(r.id);
    if (!p) return [];
    return [{ ...presentProduct(p), match: { fit: fitLabel(Number(r.tier), vehicle), group: Number(r.grp) === 0 ? ('fits' as const) : ('other' as const), partNumber: Number(r.pn) > 0 } }];
  });

  return {
    items,
    nextCursor: last ? encodeCursor({ k1: String(last.k1), k2: String(last.k2), id: last.id }) : null,
    total: params.fitsOnly && vehicle ? result.fits : result.fits + result.other,
    counts: { fits: result.fits, other: result.other },
    interpretation: {
      query: params.q ?? '',
      partNumber: analysis.partNumber,
      partNumbers: analysis.partNumbers,
      concepts,
      conceptGroups: analysis.conceptGroups,
      freeTokens: analysis.freeTokens,
      year: analysis.year,
      queryVehicle: analysis.vehicle ? { makeId: analysis.vehicle.makeId, modelId: analysis.vehicle.modelId ?? null, text: analysis.rawTokens.slice(analysis.vehicle.start, analysis.vehicle.end).join(' ') } : null,
      vehicle: vehicle ? { ...vehicle, label: vehicleLabel(vehicle, makes) } : null,
      /** The query without the vehicle words/year: what removing the vehicle chip should search. */
      withoutVehicle: analysis.vehicle || analysis.year !== null ? stripVehicleFromQuery(analysis) : null,
      unsupported,
    },
    didYouMean,
    fallback,
    suggestions: { categoryIds: [...new Set(concepts.map((c) => c.categoryId).filter((x): x is string => !!x))] },
  };
}

/** Legacy `{ total, items }` list (GET /v1/catalog/products, seller pages) on top of the ranked search. */
export async function searchCatalog(query: Omit<SearchParams, 'cursor'> & { offset: number }) {
  const r = await searchProducts(query);
  return { total: r.total, items: r.items };
}
