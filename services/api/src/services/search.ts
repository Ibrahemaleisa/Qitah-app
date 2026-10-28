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
import { vehicleFitKeys } from './listings.js';

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

/**
 * Fit for the vehicle from the read model's exploded fitment keys (one array overlap per source, GIN
 * indexed). Same rule as an EXISTS over ProductFitment: vehicle scope = model + year in range + (no engine
 * restriction, or the known engine is listed); model scope = any fitment for the model; make scope = any
 * fitment for one of its models. See `fitKeys` / `vehicleFitKeys` in services/listings.ts.
 */
function fitSql(v: ResolvedVehicle, source: 'catalog' | 'seller'): Prisma.Sql {
  const keys = vehicleFitKeys(v);
  return source === 'catalog' ? Prisma.sql`pl."catalogFitKeys" && ${keys}::text[]` : Prisma.sql`pl."sellerFitKeys" && ${keys}::text[]`;
}

function tierSql(v: ResolvedVehicle | null): Prisma.Sql {
  if (!v) return Prisma.sql`CASE WHEN pl.universal THEN 2 ELSE 3 END`;
  return Prisma.sql`CASE WHEN ${fitSql(v, 'catalog')} THEN 0 WHEN ${fitSql(v, 'seller')} THEN 1 WHEN pl.universal THEN 2 ELSE 3 END`;
}

/**
 * word_similarity(q, t) is exactly 1 when q occurs in t as whole words (every trigram of q lies in that
 * extent). Colloquial concept queries hit that for nearly every candidate (the concept's surface forms are
 * part of searchText), so a cheap LIKE skips the trigram computation without changing any value.
 */
function similaritySql(simText: string): Prisma.Sql {
  if (!simText) return Prisma.sql`0::real`;
  return Prisma.sql`(CASE WHEN (' ' || p."searchText" || ' ') LIKE ${`% ${escapeLike(simText)} %`} THEN 1::real ELSE word_similarity(${simText}, p."searchText") END)`;
}

function scoredCte(params: SearchParams, c: Criteria, vehicle: ResolvedVehicle | null): Prisma.Sql {
  const pnContains = c.partNumbers.filter((pn) => pn.length >= 4).map((pn) => Prisma.sql`p."searchText" LIKE ${contains(pn)}`);
  const conceptHit = c.groups.map((g) => anyOf(g.map((id) => Prisma.sql`p."searchText" LIKE ${contains(conceptToken(id))}`)));
  const freeHit = c.free.map((t) => anyOf(tokenVariants(t).map((v) => Prisma.sql`p."searchText" LIKE ${contains(v)}`)));

  let match: Prisma.Sql;
  // With part numbers, candidates = identifier hits ∪ trigram hits: the UNION lets both sides use their
  // index instead of one OR across a LEFT JOIN (which forces a scan of every product).
  let candidates = Prisma.empty;
  if (c.fuzzy) match = Prisma.sql`word_similarity(${c.simText}, p."searchText") >= 0.4`;
  else {
    const hasText = c.groups.length || c.free.length;
    const textMatch = hasText ? allOf([...conceptHit, ...freeHit]) : c.partNumbers.length ? Prisma.sql`FALSE` : Prisma.sql`TRUE`;
    match = c.partNumbers.length ? Prisma.sql`(ph."productId" IS NOT NULL OR ${anyOf(pnContains)} OR ${textMatch})` : textMatch;
    if (c.partNumbers.length) {
      const textual = [...pnContains, ...(hasText ? [textMatch] : [])];
      candidates = Prisma.sql`JOIN (SELECT "productId" AS id FROM pn_hits UNION SELECT p.id FROM "Product" p WHERE ${anyOf(textual)}) cand ON cand.id = p.id`;
    }
  }

  const pnHits = c.partNumbers.length
    ? Prisma.sql`SELECT i."productId", max(CASE WHEN i.normalized = ANY(${c.partNumbers}) THEN (CASE WHEN i.type = 'MPN' THEN 4 ELSE 3 END) ELSE 2 END) AS pn
        FROM "ProductIdentifier" i
        WHERE i.normalized = ANY(${c.partNumbers}) OR ${anyOf(c.partNumbers.map((pn) => Prisma.sql`i.normalized LIKE ${`${escapeLike(pn)}%`}`))}
        GROUP BY i."productId"`
    : Prisma.sql`SELECT NULL::text AS "productId", 0 AS pn WHERE FALSE`;

  // Offers come from the ProductListing read model (exactly the offers passing publicOfferWhere), so no
  // per-candidate Offer × Merchant × PickupLocation × InventoryLevel join. Without condition/merchant
  // filters the precomputed aggregates answer "has a matching offer" and the min price / dispatch; with
  // them, the per-offer summary in pl.offers is filtered (GIN/array pre-filters keep that set small).
  const perOffer = !!(params.merchantId || params.conditions?.length);
  const listingFilters: Prisma.Sql[] = [Prisma.sql`pl.listed`];
  let offerJoin = Prisma.empty;
  let price = params.inStock ? Prisma.sql`pl."minInStockPriceHalalas"::bigint` : Prisma.sql`pl."minOfferPriceHalalas"::bigint`;
  let dispatch = params.inStock ? Prisma.sql`pl."minInStockDispatchDays"::bigint` : Prisma.sql`pl."minDispatchDays"::bigint`;
  if (params.inStock) listingFilters.push(Prisma.sql`pl."inStockOfferCount" > 0`);
  if (perOffer) {
    const offerFilters: Prisma.Sql[] = [];
    if (params.merchantId) {
      listingFilters.push(Prisma.sql`pl."merchantIds" @> ARRAY[${params.merchantId}]::text[]`);
      offerFilters.push(Prisma.sql`e->>'m' = ${params.merchantId}`);
    }
    if (params.conditions?.length) {
      const upper = params.conditions.map((c) => c.toUpperCase());
      listingFilters.push(params.inStock ? Prisma.sql`pl."inStockConditions" && ${upper}::"Condition"[]` : Prisma.sql`pl."conditions" && ${upper}::"Condition"[]`);
      offerFilters.push(Prisma.sql`lower(e->>'c') = ANY(${params.conditions})`);
    }
    if (params.inStock) offerFilters.push(Prisma.sql`(e->>'a')::int > 0`);
    offerJoin = Prisma.sql`JOIN LATERAL (
        SELECT min((e->>'p')::bigint) AS price, min((e->>'d')::bigint) AS dispatch, count(*) AS n
        FROM jsonb_array_elements(pl.offers) e WHERE ${allOf(offerFilters)}
      ) ofr ON ofr.n > 0`;
    price = Prisma.sql`ofr.price`;
    dispatch = Prisma.sql`ofr.dispatch`;
  }

  const productFilters: Prisma.Sql[] = [Prisma.sql`p.status = 'ACTIVE'`, match, ...listingFilters];
  // Category on both tables: the listing's (listed, categoryId, …) index lets a category browse start there.
  if (params.categoryId) productFilters.push(Prisma.sql`p."categoryId" = ${params.categoryId}`, Prisma.sql`pl."categoryId" = ${params.categoryId}`);
  if (params.origins?.length) productFilters.push(Prisma.sql`lower(p.origin::text) = ANY(${params.origins})`);

  const sim = similaritySql(c.simText);
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
      SELECT p.id, ${pnTier} AS pn, ${ch} AS ch, ${sim} AS sim, ${tierSql(vehicle)} AS tier, ${price} AS price, ${dispatch} AS dispatch
      FROM "Product" p
      ${candidates}
      JOIN "ProductListing" pl ON pl."productId" = p.id
      LEFT JOIN pn_hits ph ON ph."productId" = p.id
      ${offerJoin}
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
type CountRow = { fits: bigint; other: bigint; pinned: bigint };

/**
 * Runs one statement with JIT disabled: these are short OLTP queries whose planner cost estimates can
 * cross jit_above_cost, and LLVM compilation then costs more (50–300 ms) than the query itself.
 */
async function withoutJit<T>(query: Prisma.Sql): Promise<T> {
  const [, rows] = await prisma.$transaction([prisma.$executeRaw`SET LOCAL jit = off`, prisma.$queryRaw<T>(query)]);
  return rows;
}

/**
 * One scan for the page AND the counts: the counts are window aggregates over every candidate (before the
 * fit filter and the cursor, which is what `counts` reports), the page is the top of the filtered set.
 * Only an empty page needs a separate count (e.g. everything hidden by "fits my car", or past the end).
 */
async function runQuery(params: SearchParams, c: Criteria, vehicle: ResolvedVehicle | null) {
  const cte = scoredCte(params, c, vehicle);
  const where: Prisma.Sql[] = [];
  // A part number the customer typed is never hidden by the fit filter.
  if (params.fitsOnly && vehicle) where.push(Prisma.sql`(grp = 0 OR pn > 0)`);
  if (params.cursor) {
    const cur = decodeCursor(params.cursor);
    where.push(
      Prisma.sql`(k1 < ${cur.k1}::bigint OR (k1 = ${cur.k1}::bigint AND k2 < ${cur.k2}::bigint) OR (k1 = ${cur.k1}::bigint AND k2 = ${cur.k2}::bigint AND id > ${cur.id}))`,
    );
  }
  const offset = !params.cursor && params.offset ? Prisma.sql`OFFSET ${params.offset}` : Prisma.empty;
  const rows = await withoutJit<(Row & CountRow)[]>(Prisma.sql`WITH ${cte}
    SELECT id, pn, tier, grp, k1, k2, fits, other, pinned FROM (
      SELECT scored.*, count(*) FILTER (WHERE grp = 0) OVER () AS fits, count(*) FILTER (WHERE grp = 1) OVER () AS other,
        count(*) FILTER (WHERE grp = 1 AND pn > 0) OVER () AS pinned
      FROM scored
    ) s WHERE ${allOf(where)}
    ORDER BY k1 DESC, k2 DESC, id ASC LIMIT ${params.limit + 1} ${offset}`);
  const counts =
    rows[0] ??
    (await withoutJit<CountRow[]>(Prisma.sql`WITH ${cte}
      SELECT count(*) FILTER (WHERE grp = 0) AS fits, count(*) FILTER (WHERE grp = 1) AS other, count(*) FILTER (WHERE grp = 1 AND pn > 0) AS pinned FROM scored`))[0];
  return { rows, fits: Number(counts?.fits ?? 0), other: Number(counts?.other ?? 0), pinned: Number(counts?.pinned ?? 0) };
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
    total: params.fitsOnly && vehicle ? result.fits + result.pinned : result.fits + result.other,
    /** `hidden`: not-confirmed parts left out by fitsOnly (what "show all" would add). */
    counts: { fits: result.fits, other: result.other, hidden: params.fitsOnly && vehicle ? result.other - result.pinned : 0 },
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
