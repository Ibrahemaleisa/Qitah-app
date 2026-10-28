import { allCategories, allProducts, getProduct } from '@/data/catalog';
import { offersForProduct } from '@/data/offers';
import { allMakes, getMake, getModel } from '@/data/vehicles';
import { isRemote } from '@/config/env';
import { fitRank, getFitStatus, type FitStatus } from '@/domain/compatibility';
import type { Category, CategoryId, Condition, L10n, Offer, PartOrigin, Product, Vehicle } from '@/domain/types';
import {
  analyzeQuery,
  conceptSearchTerms,
  getConcept,
  productConcepts,
  resolveVehicle,
  stripVehicleFromQuery,
  suggestCorrection,
  tokenVariants,
  type QueryAnalysis,
  type ResolvedVehicle,
} from '@/lib/search/lexicon';
import { looksLikePartNumber, normalizePartNumber, normalizeText, withinOneEdit } from '@/lib/text';

/**
 * Catalog query layer.
 *
 * Search understands colloquial part names and vehicles typed in the query through the shared lexicon
 * (`src/lib/search/lexicon.ts`, byte-identical to the server's copy). In DEMO mode everything below runs
 * locally on the bundled data. In REMOTE mode the search screen calls `GET /v1/catalog/search` instead
 * (see `services/remote/search.ts` and `features/search/useCatalogSearch.ts`); the functions here then
 * only serve the snapshot-backed views (home carousels, filter-sheet counts fall back to the server).
 */

export type SortKey = 'relevance' | 'priceAsc' | 'priceDesc' | 'rating' | 'fastest';

export type SearchFilters = {
  categoryId?: CategoryId;
  origins: PartOrigin[];
  conditions: Condition[];
  inStockOnly: boolean;
  /** Only parts whose fitment data covers the vehicle (selected, or typed in the query). On by default. */
  fitsVehicleOnly: boolean;
};

export const defaultFilters: SearchFilters = {
  origins: [],
  conditions: [],
  inStockOnly: true,
  fitsVehicleOnly: true,
};

export type ProductListing = {
  product: Product;
  offers: Offer[];
  bestOffer: Offer | undefined;
  offerCount: number;
  conditions: Condition[];
  fit: FitStatus;
  matchedPartNumber: boolean;
  /** `other` = fit not confirmed for the vehicle being searched; shown under a divider. */
  group?: 'fits' | 'other';
};

/** `offers` overrides the catalog lookup (remote search results carry their own live offers). */
export function buildListing(product: Product, vehicle: Vehicle | undefined, conditions: Condition[] = [], inStockOnly = false, offers?: Offer[]): ProductListing {
  const all = offers ?? offersForProduct(product.id);
  const visible = all.filter((o) => (conditions.length === 0 || conditions.includes(o.condition)) && (!inStockOnly || o.stock > 0));
  const purchasable = visible.filter((o) => o.stock > 0);
  const bestOffer = [...(purchasable.length ? purchasable : visible)].sort((a, b) => a.price - b.price)[0];
  return {
    product,
    offers: visible,
    bestOffer,
    offerCount: purchasable.length,
    conditions: [...new Set(visible.map((o) => o.condition))],
    fit: getFitStatus(product, vehicle),
    matchedPartNumber: false,
  };
}

// ───────────────────────────────────────────── search model shared by demo and remote modes

export type SearchMode = 'exact' | 'similar' | 'corrected' | 'relaxed';

export type SearchVehicleContext = ResolvedVehicle & { label: L10n };

export type SearchInterpretation = {
  concepts: { id: string; label: L10n; categoryId?: CategoryId; carried: boolean }[];
  /** Parts Qitah doesn't list yet (tires, clutch…): the no-results state offers a request instead. */
  unsupported: { id: string; label: L10n }[];
  /** The vehicle results are checked against (typed in the query, or the selected one). */
  vehicle: SearchVehicleContext | null;
  /** The query without its vehicle words/year — what removing the vehicle chip searches. */
  withoutVehicle: string | null;
  didYouMean: string | null;
  partNumber: boolean;
};

export type SearchOutcome = {
  /** Visible results: fitting parts first, then (unless fitsOnly) the not-confirmed ones. */
  results: ProductListing[];
  fits: ProductListing[];
  others: ProductListing[];
  /** Not-confirmed parts hidden by the "fits my car" filter. */
  hiddenOthers: number;
  total: number;
  mode: SearchMode;
  /** The query actually used when `mode === 'corrected'`. */
  correctedQuery?: string;
  partNumberQuery: boolean;
  interpretation: SearchInterpretation;
};

export type SearchInput = {
  query: string;
  filters: SearchFilters;
  sort: SortKey;
  vehicle?: Vehicle;
};

export function emptyInterpretation(): SearchInterpretation {
  return { concepts: [], unsupported: [], vehicle: null, withoutVehicle: null, didYouMean: null, partNumber: false };
}

export function vehicleContextLabel(v: ResolvedVehicle): L10n {
  const model = v.modelId ? getModel(v.modelId) : undefined;
  const make = v.makeId ? getMake(v.makeId) : undefined;
  const year = v.year !== undefined ? ` ${v.year}` : '';
  if (model) return { ar: `${model.name.ar}${year}`, en: `${model.name.en}${year}` };
  if (make) return { ar: make.name.ar, en: make.name.en };
  return { ar: '', en: '' };
}

/** The Vehicle fit badges are computed against: the selected one when it is the same car, else the typed model/year with no engine. */
export function listingVehicle(v: ResolvedVehicle | null, selected: Vehicle | undefined): Vehicle | undefined {
  if (!v || v.scope !== 'vehicle' || !v.modelId || v.year === undefined) return undefined;
  if (selected && selected.modelId === v.modelId && selected.year === v.year && (v.engine ?? '') === selected.engine) return selected;
  return { id: 'search', makeId: v.makeId ?? '', modelId: v.modelId, year: v.year, trim: '', engine: v.engine ?? '', addedAt: 0 };
}

/** Whether a listing is in the "fits" group for the searched vehicle (conservative: no data → other). */
export function fitsGroup(product: Product, fit: FitStatus, v: ResolvedVehicle | null): boolean {
  if (!v) return true;
  if (product.universal) return true;
  if (v.scope === 'vehicle') return fit === 'catalogMatch' || fit === 'sellerReported' || fit === 'bySpecification';
  if (v.scope === 'model') return product.fitment.some((f) => f.modelId === v.modelId);
  const models = new Set(getMake(v.makeId ?? '')?.models.map((m) => m.id) ?? []);
  return product.fitment.some((f) => models.has(f.modelId));
}

export function interpretationFrom(a: QueryAnalysis, vehicle: ResolvedVehicle | null): SearchInterpretation {
  const seen = new Set<string>();
  const concepts: SearchInterpretation['concepts'] = [];
  for (const span of a.concepts) {
    for (const id of span.conceptIds) {
      const c = getConcept(id);
      if (!c || seen.has(id)) continue;
      seen.add(id);
      concepts.push({ id, label: c.label, categoryId: c.categoryId as CategoryId | undefined, carried: c.carried });
    }
  }
  return {
    concepts,
    unsupported: concepts.filter((c) => !c.carried).map(({ id, label }) => ({ id, label })),
    vehicle: vehicle ? { ...vehicle, label: vehicleContextLabel(vehicle) } : null,
    withoutVehicle: a.vehicle || a.year !== null ? stripVehicleFromQuery(a) : null,
    didYouMean: suggestCorrection(a),
    partNumber: !!a.partNumber,
  };
}

// ───────────────────────────────────────────── local (demo-mode) matching

type Meta = { concepts: Set<string>; text: string; mpn: string; oem: string[] };
const metaCache = new WeakMap<Product, Meta>();

function productMeta(product: Product): Meta {
  const cached = metaCache.get(product);
  if (cached) return cached;
  const category = allCategories().find((c) => c.id === product.categoryId);
  const concepts = productConcepts({ nameAr: product.name.ar, nameEn: product.name.en, categoryId: product.categoryId, art: product.art, keywords: product.keywords });
  const mpn = normalizePartNumber(product.partNumber);
  const oem = product.oemReferences.map(normalizePartNumber);
  const text = [
    normalizeText([product.name.ar, product.name.en, product.brand, category?.name.ar ?? '', category?.name.en ?? '', ...product.keywords].join(' ')),
    mpn,
    ...oem,
    ...conceptSearchTerms(concepts),
  ].join(' ');
  const meta = { concepts: new Set(concepts), text, mpn, oem };
  metaCache.set(product, meta);
  return meta;
}

/** 4 exact MPN, 3 exact OEM reference, 2 prefix, 1 contained, 0 none. */
function partNumberTier(meta: Meta, pns: string[]): number {
  let tier = 0;
  for (const pn of pns) {
    if (pn.length < 4) continue;
    if (meta.mpn === pn) tier = Math.max(tier, 4);
    else if (meta.oem.includes(pn)) tier = Math.max(tier, 3);
    else if (meta.mpn.startsWith(pn) || meta.oem.some((o) => o.startsWith(pn))) tier = Math.max(tier, 2);
    else if (meta.text.includes(pn)) tier = Math.max(tier, 1);
  }
  return tier;
}

type Criteria = { groups: string[][]; free: string[]; partNumbers: string[]; fuzzy: string[] | null };

function criteriaFrom(a: QueryAnalysis): Criteria {
  return { groups: a.conceptGroups, free: a.freeTokens, partNumbers: a.partNumber ? [a.partNumber] : a.partNumbers, fuzzy: null };
}

type Scored = { listing: ProductListing; pn: number; concepts: number };

function runLocal(input: SearchInput, c: Criteria, vehicle: ResolvedVehicle | null): Scored[] {
  const { filters } = input;
  const fitVehicle = listingVehicle(vehicle, input.vehicle);
  const textual = c.groups.length > 0 || c.free.length > 0;
  const out: Scored[] = [];
  for (const product of allProducts()) {
    if (filters.categoryId && product.categoryId !== filters.categoryId) continue;
    if (filters.origins.length && !filters.origins.includes(product.origin)) continue;
    const meta = productMeta(product);
    const pn = c.partNumbers.length ? partNumberTier(meta, c.partNumbers) : 0;
    const conceptHits = c.groups.filter((g) => g.some((id) => meta.concepts.has(id))).length;
    let matched: boolean;
    if (c.fuzzy) {
      const words = meta.text.split(/\s+/);
      matched = c.fuzzy.some((t) => words.some((w) => w.includes(t) || (t.length >= 4 && w.length >= 4 && withinOneEdit(t, w))));
    } else {
      const textOk = textual && conceptHits === c.groups.length && c.free.every((t) => tokenVariants(t).some((v) => meta.text.includes(v)));
      matched = pn > 0 || textOk || (!textual && c.partNumbers.length === 0);
    }
    if (!matched) continue;
    const listing = buildListing(product, fitVehicle, filters.conditions, filters.inStockOnly);
    if (!listing.bestOffer) continue;
    listing.matchedPartNumber = pn > 0;
    listing.group = fitsGroup(product, listing.fit, vehicle) ? 'fits' : 'other';
    out.push({ listing, pn, concepts: conceptHits });
  }
  return out;
}

function sortScored(results: Scored[], sort: SortKey) {
  const price = (s: Scored) => s.listing.bestOffer?.price ?? Number.MAX_SAFE_INTEGER;
  const dispatch = (s: Scored) => Math.min(...s.listing.offers.map((o) => o.dispatchDays[0]));
  results.sort((a, b) => {
    if (sort === 'relevance' && a.pn !== b.pn) return b.pn - a.pn;
    const group = (a.listing.group === 'other' ? 1 : 0) - (b.listing.group === 'other' ? 1 : 0);
    if (group !== 0) return group;
    switch (sort) {
      case 'priceAsc':
        return price(a) - price(b);
      case 'priceDesc':
        return price(b) - price(a);
      case 'rating':
        return (b.listing.product.rating?.average ?? 0) - (a.listing.product.rating?.average ?? 0);
      case 'fastest':
        return dispatch(a) - dispatch(b);
      case 'relevance':
      default: {
        if (a.concepts !== b.concepts) return b.concepts - a.concepts;
        const fit = fitRank(a.listing.fit) - fitRank(b.listing.fit);
        if (fit !== 0) return fit;
        return (b.listing.product.rating?.count ?? 0) - (a.listing.product.rating?.count ?? 0);
      }
    }
  });
}

function runSearch(input: SearchInput, withFallback: boolean): SearchOutcome {
  const makes = allMakes();
  const analysis = analyzeQuery(input.query, makes);
  const garage = input.vehicle ? { makeId: input.vehicle.makeId, modelId: input.vehicle.modelId, year: input.vehicle.year, engine: input.vehicle.engine } : undefined;
  const vehicle = resolveVehicle(analysis, garage, makes);
  const interpretation = interpretationFrom(analysis, vehicle);
  const base = criteriaFrom(analysis);
  const partNumberQuery = looksLikePartNumber(input.query.trim());

  let mode: SearchMode = 'exact';
  let correctedQuery: string | undefined;
  let scored = runLocal(input, base, vehicle);
  const onlyUnsupported = interpretation.unsupported.length > 0 && interpretation.concepts.every((c) => !c.carried) && !base.free.length && !base.partNumbers.length;
  if (withFallback && scored.length === 0 && (base.groups.length || base.free.length) && !onlyUnsupported && !partNumberQuery) {
    const attempts: { mode: SearchMode; criteria: Criteria; query?: string }[] = [];
    if (interpretation.didYouMean) attempts.push({ mode: 'corrected', criteria: criteriaFrom(analyzeQuery(interpretation.didYouMean, makes)), query: interpretation.didYouMean });
    if (base.groups.length && base.free.length) attempts.push({ mode: 'relaxed', criteria: { ...base, free: [] } });
    const fuzzyTokens = normalizeText(input.query).split(/\s+/).filter((t) => t.length >= 3);
    if (fuzzyTokens.length) attempts.push({ mode: 'similar', criteria: { ...base, fuzzy: fuzzyTokens } });
    for (const attempt of attempts) {
      const r = runLocal(input, attempt.criteria, vehicle);
      if (r.length) {
        scored = r;
        mode = attempt.mode;
        correctedQuery = attempt.query;
        break;
      }
    }
  }

  sortScored(scored, input.sort);
  const hideOthers = input.filters.fitsVehicleOnly && !!vehicle;
  const fits = scored.filter((s) => s.listing.group !== 'other').map((s) => s.listing);
  // A part number the customer typed is never hidden by the fit filter; it shows under the divider.
  const others = scored.filter((s) => s.listing.group === 'other' && (!hideOthers || s.pn > 0)).map((s) => s.listing);
  const hiddenOthers = scored.filter((s) => s.listing.group === 'other').length - others.length;
  const results = [...fits, ...others];
  return {
    results,
    fits,
    others,
    hiddenOthers,
    total: results.length,
    mode,
    correctedQuery,
    partNumberQuery,
    interpretation,
  };
}

/** Exact matches only (no spelling fallback) — the visible list for the given filters. */
export function searchProducts(input: SearchInput): ProductListing[] {
  return runSearch(input, false).results;
}

/**
 * Exact search first; if it finds nothing, retry: a one-edit spelling correction from the lexicon
 * ("فحمت" → "فحمات"), then the part concepts without the extra words, then a forgiving word match
 * (any word, one typo). Concepts Qitah doesn't carry (tires…) skip the retries so the UI can offer a request.
 */
export function searchWithFallback(input: SearchInput): SearchOutcome {
  return runSearch(input, true);
}

/** Categories whose name matches the query, offered as one-tap scoped searches. */
export function categorySuggestions(query: string): Category[] {
  const tokens = normalizeText(query).split(/\s+/).filter((t) => t.length >= 2);
  if (!tokens.length) return [];
  return allCategories().filter((c) => {
    const names = [normalizeText(c.name.ar), normalizeText(c.name.en)];
    return tokens.some((t) => names.some((n) => n.includes(t) || n.split(/\s+/).some((w) => w.startsWith(t))));
  });
}

/** Recommendations: catalog-backed matches for the selected vehicle, then popular items. */
export function recommendedFor(vehicle: Vehicle | undefined, limit = 8): ProductListing[] {
  return searchProducts({ query: '', filters: { ...defaultFilters }, sort: 'relevance', vehicle })
    .filter((l) => (vehicle ? l.fit === 'catalogMatch' : true))
    .slice(0, limit);
}

export function featuredListings(vehicle: Vehicle | undefined): ProductListing[] {
  const ids = ['p-oil-5w30', 'p-cabin-filter-hk', 'p-battery-70', 'p-lc-rotor-slotted', 'p-spark-iridium', 'p-camry-pads-ceramic'];
  return ids
    .map((id) => getProduct(id))
    .filter((p): p is Product => !!p)
    .map((p) => buildListing(p, vehicle, [], true))
    .filter((l) => !isRemote || l.offers.length > 0);
}

export function listingsByIds(ids: string[], vehicle: Vehicle | undefined): ProductListing[] {
  return ids
    .map((id) => getProduct(id))
    .filter((p): p is Product => !!p)
    .map((p) => buildListing(p, vehicle));
}

export const popularSearches = [
  { ar: 'فحمات فرامل', en: 'brake pads' },
  { ar: 'فلتر زيت', en: 'oil filter' },
  { ar: 'بطارية', en: 'battery' },
  { ar: 'زيت محرك', en: 'engine oil' },
  { ar: 'بواجي', en: 'spark plugs' },
  { ar: 'مساعد', en: 'shock absorber' },
];
