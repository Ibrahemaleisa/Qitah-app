import { toOffer, toProduct } from '@/api/adapters';
import { catalogApi } from '@/api/endpoints';
import type { ApiSearchInterpretation, SearchQuery, SearchResponse } from '@/api/types';
import { allCategories } from '@/data/catalog';
import { cacheApiProducts } from '@/services/remote/catalogSync';
import type { CategoryId, Vehicle } from '@/domain/types';
import type { ResolvedVehicle } from '@/lib/search/lexicon';
import {
  buildListing,
  fitsGroup,
  listingVehicle,
  vehicleContextLabel,
  type ProductListing,
  type SearchInput,
  type SearchInterpretation,
  type SearchMode,
} from '@/services/catalog';

/**
 * Remote-mode search: `GET /v1/catalog/search` (there is no downloaded catalog to filter any more). Result
 * products are added to the bounded on-demand product cache (catalogSync.ts) so detail opens instantly.
 */

export const SEARCH_PAGE_SIZE = 20;

export type RemoteSearchPage = {
  fits: ProductListing[];
  others: ProductListing[];
  hiddenOthers: number;
  total: number;
  nextCursor: string | null;
  mode: SearchMode;
  correctedQuery?: string;
  partNumberQuery: boolean;
  interpretation: SearchInterpretation;
};

export function toSearchQuery(input: SearchInput, cursor?: string, limit = SEARCH_PAGE_SIZE): SearchQuery {
  const { filters, vehicle } = input;
  return {
    q: input.query,
    modelId: vehicle?.modelId,
    year: vehicle?.year,
    engine: vehicle?.engine || undefined,
    fitsOnly: filters.fitsVehicleOnly,
    categoryId: filters.categoryId,
    origin: filters.origins,
    condition: filters.conditions,
    inStock: filters.inStockOnly,
    // No verified ratings exist yet, so "top rated" falls back to relevance on the server.
    sort: input.sort === 'rating' ? 'relevance' : input.sort,
    cursor,
    limit,
  };
}

function toInterpretation(i: ApiSearchInterpretation | undefined, didYouMean: string | null): SearchInterpretation {
  const seen = new Set<string>();
  const concepts = (i?.concepts ?? [])
    .filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
    .map((c) => ({ id: c.id, label: c.label, categoryId: (c.categoryId ?? undefined) as CategoryId | undefined, carried: c.carried }));
  const v = i?.vehicle ?? null;
  const vehicle: ResolvedVehicle | null = v
    ? { source: v.source, makeId: v.makeId, modelId: v.modelId, year: v.year, engine: v.engine, scope: v.scope, yearOutOfRange: v.yearOutOfRange }
    : null;
  return {
    concepts,
    unsupported: i?.unsupported ?? [],
    vehicle: vehicle ? { ...vehicle, label: v?.label ?? vehicleContextLabel(vehicle) } : null,
    withoutVehicle: i?.withoutVehicle ?? null,
    didYouMean,
    partNumber: !!i?.partNumber,
  };
}

/** Maps a server page onto the listings the search screen renders (fit badges computed like product detail). */
export function toSearchPage(res: SearchResponse, input: SearchInput): RemoteSearchPage {
  const interpretation = toInterpretation(res.interpretation, res.didYouMean ?? null);
  const fitVehicle: Vehicle | undefined = listingVehicle(interpretation.vehicle, input.vehicle);
  const artFor = new Map(allCategories().map((c) => [c.id as string, c.art]));
  const fits: ProductListing[] = [];
  const others: ProductListing[] = [];
  for (const item of res.items ?? []) {
    const product = toProduct(item, artFor.get(item.categoryId));
    const listing = buildListing(product, fitVehicle, input.filters.conditions, input.filters.inStockOnly, (item.offers ?? []).map(toOffer));
    listing.matchedPartNumber = !!item.match?.partNumber;
    const group = item.match?.group === 'other' || item.match?.group === 'fits' ? item.match.group : fitsGroup(product, listing.fit, interpretation.vehicle) ? 'fits' : 'other';
    listing.group = group;
    (group === 'other' ? others : fits).push(listing);
  }
  const fallback = res.fallback;
  return {
    fits,
    others,
    hiddenOthers: res.counts?.hidden ?? 0,
    total: res.total ?? fits.length + others.length,
    nextCursor: res.nextCursor ?? null,
    mode: fallback ? fallback.mode : 'exact',
    correctedQuery: fallback?.mode === 'corrected' ? fallback.query : undefined,
    partNumberQuery: !!res.interpretation?.partNumber,
    interpretation,
  };
}

export async function remoteSearch(input: SearchInput, opts: { cursor?: string; limit?: number; signal?: AbortSignal } = {}): Promise<RemoteSearchPage> {
  const res = await catalogApi.search(toSearchQuery(input, opts.cursor, opts.limit), opts.signal);
  // Results come with live offers: keep them in the bounded cache (no sellers yet → partial) so opening a
  // product is instant; product detail then loads the sellers in the background.
  cacheApiProducts(res.items ?? [], [], true);
  return toSearchPage(res, input);
}

/** Appends a further page, keeping the fits/others split and dropping duplicates. */
export function mergePages(prev: RemoteSearchPage, next: RemoteSearchPage): RemoteSearchPage {
  const seen = new Set([...prev.fits, ...prev.others].map((l) => l.product.id));
  const fresh = (list: ProductListing[]) => list.filter((l) => !seen.has(l.product.id));
  return { ...next, interpretation: prev.interpretation, mode: prev.mode, correctedQuery: prev.correctedQuery, fits: [...prev.fits, ...fresh(next.fits)], others: [...prev.others, ...fresh(next.others)] };
}
