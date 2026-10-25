import { categories, products } from '@/data/catalog';
import { offersForProduct } from '@/data/offers';
import { fitRank, getFitStatus, type FitStatus } from '@/domain/compatibility';
import type { Category, CategoryId, Condition, Offer, PartOrigin, Product, Vehicle } from '@/domain/types';
import { looksLikePartNumber, normalizePartNumber, normalizeText, withinOneEdit } from '@/lib/text';

/**
 * Catalog query layer. Today it reads bundled SAMPLE data synchronously; the function
 * signatures mirror the future remote catalog API so screens won't change when
 * TanStack Query + a real backend are introduced.
 */

export type SortKey = 'relevance' | 'priceAsc' | 'priceDesc' | 'rating' | 'fastest';

export type SearchFilters = {
  categoryId?: CategoryId;
  origins: PartOrigin[];
  conditions: Condition[];
  inStockOnly: boolean;
  fitsVehicleOnly: boolean;
};

export const defaultFilters: SearchFilters = {
  origins: [],
  conditions: [],
  inStockOnly: true,
  fitsVehicleOnly: false,
};

export type ProductListing = {
  product: Product;
  offers: Offer[];
  bestOffer: Offer | undefined;
  offerCount: number;
  conditions: Condition[];
  fit: FitStatus;
  matchedPartNumber: boolean;
};

export function buildListing(product: Product, vehicle: Vehicle | undefined, conditions: Condition[] = [], inStockOnly = false): ProductListing {
  const all = offersForProduct(product.id);
  const visible = all.filter(
    (o) => (conditions.length === 0 || conditions.includes(o.condition)) && (!inStockOnly || o.stock > 0),
  );
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

function haystack(product: Product): string {
  const category = categories.find((c) => c.id === product.categoryId);
  return normalizeText(
    [
      product.name.ar,
      product.name.en,
      product.brand,
      category?.name.ar ?? '',
      category?.name.en ?? '',
      ...product.keywords,
    ].join(' '),
  );
}

function matchesPartNumber(product: Product, query: string): boolean {
  const q = normalizePartNumber(query);
  if (q.length < 4) return false;
  return [product.partNumber, ...product.oemReferences].some((pn) => normalizePartNumber(pn).includes(q));
}

export type SearchInput = {
  query: string;
  filters: SearchFilters;
  sort: SortKey;
  vehicle?: Vehicle;
};

export function searchProducts({ query, filters, sort, vehicle }: SearchInput): ProductListing[] {
  const trimmed = query.trim();
  const tokens = normalizeText(trimmed).split(/\s+/).filter(Boolean);
  const partNumberQuery = looksLikePartNumber(trimmed);

  const results: ProductListing[] = [];
  for (const product of products) {
    if (filters.categoryId && product.categoryId !== filters.categoryId) continue;
    if (filters.origins.length && !filters.origins.includes(product.origin)) continue;

    let matchedPartNumber = false;
    if (tokens.length) {
      matchedPartNumber = matchesPartNumber(product, trimmed);
      const text = haystack(product);
      const textMatch = tokens.every((t) => text.includes(t));
      if (!textMatch && !matchedPartNumber) continue;
    }

    const listing = buildListing(product, vehicle, filters.conditions, filters.inStockOnly);
    if (!listing.bestOffer) continue;
    if (filters.fitsVehicleOnly && vehicle && !['catalogMatch', 'sellerReported', 'bySpecification'].includes(listing.fit)) continue;
    listing.matchedPartNumber = matchedPartNumber;
    results.push(listing);
  }

  const price = (l: ProductListing) => l.bestOffer?.price ?? Number.MAX_SAFE_INTEGER;
  const dispatch = (l: ProductListing) => Math.min(...l.offers.map((o) => o.dispatchDays[0]));
  results.sort((a, b) => {
    switch (sort) {
      case 'priceAsc':
        return price(a) - price(b);
      case 'priceDesc':
        return price(b) - price(a);
      case 'rating':
        return (b.product.rating?.average ?? 0) - (a.product.rating?.average ?? 0);
      case 'fastest':
        return dispatch(a) - dispatch(b);
      case 'relevance':
      default: {
        if (partNumberQuery && a.matchedPartNumber !== b.matchedPartNumber) return a.matchedPartNumber ? -1 : 1;
        const fit = fitRank(a.fit) - fitRank(b.fit);
        if (fit !== 0) return fit;
        return (b.product.rating?.count ?? 0) - (a.product.rating?.count ?? 0);
      }
    }
  });
  return results;
}

export type SearchOutcome = {
  results: ProductListing[];
  /** `similar` when nothing matched exactly and a forgiving match (typo / partial words) was used. */
  mode: 'exact' | 'similar';
  partNumberQuery: boolean;
};

/**
 * Exact search first; if it finds nothing, retry forgivingly: any meaningful word may match,
 * and words of 4+ letters tolerate one typo. Results are labelled `similar` in the UI.
 */
export function searchWithFallback(input: SearchInput): SearchOutcome {
  const partNumberQuery = looksLikePartNumber(input.query.trim());
  const exact = searchProducts(input);
  const tokens = normalizeText(input.query).split(/\s+/).filter((t) => t.length >= 3);
  if (exact.length > 0 || tokens.length === 0 || partNumberQuery) return { results: exact, mode: 'exact', partNumberQuery };

  const all = searchProducts({ ...input, query: '' });
  const similar = all.filter((listing) => {
    const words = haystack(listing.product).split(/\s+/);
    return tokens.some((t) => words.some((w) => w.includes(t) || (t.length >= 4 && w.length >= 4 && withinOneEdit(t, w))));
  });
  return { results: similar, mode: similar.length ? 'similar' : 'exact', partNumberQuery };
}

/** Categories whose name matches the query, offered as one-tap scoped searches. */
export function categorySuggestions(query: string): Category[] {
  const tokens = normalizeText(query).split(/\s+/).filter((t) => t.length >= 2);
  if (!tokens.length) return [];
  return categories.filter((c) => {
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
    .map((id) => products.find((p) => p.id === id))
    .filter((p): p is Product => !!p)
    .map((p) => buildListing(p, vehicle, [], true));
}

export function listingsByIds(ids: string[], vehicle: Vehicle | undefined): ProductListing[] {
  return ids
    .map((id) => products.find((p) => p.id === id))
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
