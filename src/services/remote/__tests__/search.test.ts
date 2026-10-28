import { configureApi } from '@/api/client';
import type { ApiProduct, SearchResponse } from '@/api/types';
import type { Vehicle } from '@/domain/types';
import { defaultFilters, type SearchInput } from '@/services/catalog';
import { mergePages, remoteSearch, toSearchPage, toSearchQuery } from '@/services/remote/search';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('expo-secure-store', () => ({ getItemAsync: jest.fn(async () => null), setItemAsync: jest.fn(async () => {}), deleteItemAsync: jest.fn(async () => {}) }));

const camry: Vehicle ={ id: 'v1', makeId: 'toyota', modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4', addedAt: 0 };

function apiProduct(id: string, over: Partial<ApiProduct> = {}): ApiProduct {
  return {
    id,
    name: { ar: 'فلتر زيت', en: 'Oil filter' },
    description: { ar: '', en: '' },
    categoryId: 'filters',
    brand: 'Toyota Genuine',
    origin: 'oem',
    partNumber: `PN-${id}`,
    oemReferences: [],
    specs: [],
    fitment: [{ modelId: 'camry', yearFrom: 2018, yearTo: 2025, source: 'catalog' }],
    art: 'oilFilter',
    keywords: [],
    rating: null,
    offers: [
      { id: `o-${id}`, productId: id, sellerId: 's1', priceHalalas: 4500, compareAtHalalas: null, available: 3, condition: 'new', warrantyMonths: 0, dispatchDays: [0, 1], originCity: 'riyadh', noteAr: null, noteEn: null },
    ],
    ...over,
  };
}

function response(over: Partial<SearchResponse> = {}): SearchResponse {
  return {
    items: [
      { ...apiProduct('p1'), match: { fit: 'catalogMatch', group: 'fits', partNumber: false } },
      { ...apiProduct('p2', { fitment: [{ modelId: 'patrol', yearFrom: 2016, yearTo: 2025, source: 'catalog' }] }), match: { fit: 'noData', group: 'other', partNumber: false } },
    ],
    nextCursor: 'CURSOR-2',
    total: 2,
    counts: { fits: 1, other: 4, hidden: 3 },
    interpretation: {
      query: 'فلتر زيت كامري 2022',
      partNumber: null,
      partNumbers: [],
      concepts: [{ id: 'oilFilter', label: { ar: 'فلتر زيت', en: 'Oil filter' }, categoryId: 'filters', carried: true, term: 'فلتر زيت' }],
      conceptGroups: [['oilFilter']],
      freeTokens: [],
      year: 2022,
      queryVehicle: { makeId: 'toyota', modelId: 'camry', text: 'كامري' },
      vehicle: { source: 'query', makeId: 'toyota', modelId: 'camry', year: 2022, scope: 'vehicle', label: { ar: 'كامري 2022', en: 'Camry 2022' } },
      withoutVehicle: 'فلتر زيت',
      unsupported: [],
    },
    didYouMean: null,
    fallback: null,
    ...over,
  };
}

const input = (over: Partial<SearchInput> = {}): SearchInput => ({ query: 'فلتر زيت كامري 2022', filters: { ...defaultFilters }, sort: 'relevance', ...over });

describe('remote search adapter', () => {
  it('maps the screen state onto GET /v1/catalog/search parameters', () => {
    expect(toSearchQuery(input({ vehicle: camry, sort: 'rating', filters: { ...defaultFilters, origins: ['oem'], conditions: ['used'], categoryId: 'filters' } }), 'C1')).toEqual({
      q: 'فلتر زيت كامري 2022',
      modelId: 'camry',
      year: 2022,
      engine: '2.5L I4',
      fitsOnly: true,
      categoryId: 'filters',
      origin: ['oem'],
      condition: ['used'],
      inStock: true,
      sort: 'relevance',
      cursor: 'C1',
      limit: 20,
    });
  });

  it('turns a server page into listings split by fit, with the interpretation for the chip', () => {
    const page = toSearchPage(response(), input());
    expect(page.fits.map((l) => l.product.id)).toEqual(['p1']);
    expect(page.others.map((l) => l.product.id)).toEqual(['p2']);
    expect(page.fits[0].fit).toBe('catalogMatch');
    expect(page.others[0].fit).toBe('noData');
    expect(page.fits[0].bestOffer?.price).toBe(45);
    expect(page.hiddenOthers).toBe(3);
    expect(page.nextCursor).toBe('CURSOR-2');
    expect(page.interpretation.concepts.map((c) => c.id)).toEqual(['oilFilter']);
    expect(page.interpretation.vehicle).toMatchObject({ modelId: 'camry', year: 2022, source: 'query', label: { en: 'Camry 2022' } });
    expect(page.interpretation.withoutVehicle).toBe('فلتر زيت');
    expect(page.mode).toBe('exact');
  });

  it('reports fallbacks and parts we do not carry', () => {
    const corrected = toSearchPage(response({ fallback: { mode: 'corrected', query: 'فحمات' }, didYouMean: 'فحمات' }), input({ query: 'فحمت' }));
    expect(corrected.mode).toBe('corrected');
    expect(corrected.correctedQuery).toBe('فحمات');
    const tires = toSearchPage(
      response({ items: [], total: 0, nextCursor: null, interpretation: { ...response().interpretation, concepts: [], vehicle: null, unsupported: [{ id: 'tires', label: { ar: 'كفرات', en: 'Tires' } }] } }),
      input({ query: 'كفرات' }),
    );
    expect(tires.fits).toHaveLength(0);
    expect(tires.interpretation.unsupported.map((u) => u.id)).toEqual(['tires']);
  });

  it('calls the server with the query string and can be cancelled', async () => {
    const calls: string[] = [];
    configureApi({
      baseUrl: 'http://api.test',
      sleep: async () => {},
      fetchImpl: (async (url: string) => {
        calls.push(url);
        return { ok: true, status: 200, text: async () => JSON.stringify(response()) } as Response;
      }) as unknown as typeof fetch,
    });
    const page = await remoteSearch(input({ vehicle: camry }));
    expect(page.fits).toHaveLength(1);
    const url = new URL(calls[0]);
    expect(url.pathname).toBe('/v1/catalog/search');
    expect(url.searchParams.get('q')).toBe('فلتر زيت كامري 2022');
    expect(url.searchParams.get('modelId')).toBe('camry');
    expect(url.searchParams.get('fitsOnly')).toBe('true');
    expect(url.searchParams.get('inStock')).toBe('true');

    const ac = new AbortController();
    configureApi({
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })) as unknown as typeof fetch,
    });
    const pending = remoteSearch(input(), { signal: ac.signal });
    ac.abort();
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' });
  });

  it('appends further pages without duplicates', () => {
    const first = toSearchPage(response(), input());
    const second = toSearchPage(response({ items: [{ ...apiProduct('p1'), match: { fit: 'catalogMatch', group: 'fits', partNumber: false } }, { ...apiProduct('p3'), match: { fit: 'noData', group: 'other', partNumber: false } }], nextCursor: null }), input());
    const merged = mergePages(first, second);
    expect(merged.fits.map((l) => l.product.id)).toEqual(['p1']);
    expect(merged.others.map((l) => l.product.id)).toEqual(['p2', 'p3']);
    expect(merged.nextCursor).toBeNull();
  });
});
