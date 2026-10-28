import {
  canAccept,
  photoContentType,
  toPartQuote,
  toPartRequestDetail,
  toPartRequestSummary,
  toPrivateCatalog,
  type ApiPartQuote,
  type ApiPartRequestDetail,
  type ApiPartRequestSummary,
} from '@/api/partRequests';
import type { ApiProduct, ApiSeller } from '@/api/types';
import { addPrivateCatalog, catalogIndex, clearPrivateCatalog, isPrivateOffer, setCatalogData, setPrivateCatalog, useRemoteCatalog } from '@/catalog/remote-catalog';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const NOW = Date.parse('2026-10-28T10:00:00.000Z');

const core = {
  id: 'pr-1',
  number: 'RQ-ABC1234',
  status: 'QUOTED',
  vehicle: { makeId: 'ford', modelId: 'taurus', year: 2021, engine: '1.5L EcoBoost', vin: null, label: { ar: 'فورد توروس 2021', en: 'Ford Taurus 2021' } },
  description: 'حساس أكسجين خلفي',
  partNumber: 'DG9Z-9G444-A',
  quantity: 1,
  preferredCondition: 'used',
  preferredOrigin: 'any',
  city: 'riyadh',
  photoCount: 1,
  createdAt: '2026-10-28T09:50:00.000Z',
  expiresAt: '2026-10-31T09:50:00.000Z',
  firstQuotedAt: '2026-10-28T09:56:00.000Z',
  acceptedAt: null,
} satisfies Omit<ApiPartRequestSummary, 'quoteCount' | 'bestPriceHalalas'>;

const quote = (over: Partial<ApiPartQuote> = {}): ApiPartQuote => ({
  id: 'q-1',
  status: 'ACTIVE',
  expired: false,
  merchant: { id: 's-salvage', name: { ar: 'تشليح الرياض', en: 'Riyadh Salvage' }, city: 'riyadh', verifiedBusiness: true },
  seller: null,
  originCity: 'riyadh',
  part: { productId: null, name: { ar: 'حساس أكسجين', en: 'حساس أكسجين' }, brand: 'Motorcraft', partNumber: 'DG9Z-9G444-A', origin: 'oem' },
  condition: 'used',
  priceHalalas: 8550,
  quantity: 1,
  warrantyMonths: 1,
  dispatchDays: [0, 1],
  note: 'مفحوص',
  validUntil: '2026-10-29T09:56:00.000Z',
  photoUrl: 'https://api.example/v1/uploads/local?key=x&sig=y',
  offerId: null,
  ...over,
});

describe('part request adapters', () => {
  it('maps a summary: status, preferences, city, timestamps, best price in SAR', () => {
    const r = toPartRequestSummary({ ...core, quoteCount: 2, bestPriceHalalas: 8550 });
    expect(r).toMatchObject({ status: 'quoted', preferredCondition: 'used', preferredOrigin: 'any', city: 'riyadh', quoteCount: 2, bestPrice: 85.5, partNumber: 'DG9Z-9G444-A', engine: '1.5L EcoBoost' });
    expect(r.createdAt).toBe(Date.parse(core.createdAt));
    expect(r.firstQuotedAt).toBe(Date.parse(core.firstQuotedAt));
    expect(r.vehicleLabel.en).toBe('Ford Taurus 2021');
  });

  it('is conservative with unknown values', () => {
    const r = toPartRequestSummary({ ...core, status: 'SOMETHING', preferredCondition: 'shiny', city: 'atlantis', partNumber: '  ', quoteCount: 0, bestPriceHalalas: null });
    expect(r.status).toBe('expired');
    expect(r.preferredCondition).toBe('any');
    expect(r.city).toBeUndefined();
    expect(r.partNumber).toBeUndefined();
    expect(r.bestPrice).toBeUndefined();
  });

  it('maps a quote: halalas → SAR, condition, origin, dispatch, validity', () => {
    const q = toPartQuote(quote(), NOW);
    expect(q).toMatchObject({ price: 85.5, condition: 'used', origin: 'oem', dispatchDays: [0, 1], warrantyMonths: 1, sellerId: 's-salvage', verifiedSeller: true, brand: 'Motorcraft', expired: false, status: 'active' });
    expect(q.validUntil).toBe(Date.parse('2026-10-29T09:56:00.000Z'));
  });

  it('never presents an unknown condition as new and flags lapsed quotes as expired', () => {
    const q = toPartQuote(quote({ condition: 'MYSTERY', validUntil: '2026-10-28T09:00:00.000Z', dispatchDays: [] }), NOW);
    expect(q.condition).toBe('used');
    expect(q.expired).toBe(true);
    expect(q.dispatchDays).toEqual([0, 1]);
  });

  it('sorts quotes by price and derives the live count / best price', () => {
    const detail: ApiPartRequestDetail = {
      ...core,
      photos: [{ url: 'https://a/1' }],
      quotes: [quote({ id: 'q-2', priceHalalas: 14950 }), quote({ id: 'q-1', priceHalalas: 8550 })],
    };
    const d = toPartRequestDetail(detail, NOW);
    expect(d.quotes.map((q) => q.id)).toEqual(['q-1', 'q-2']);
    expect(d.quoteCount).toBe(2);
    expect(d.bestPrice).toBe(85.5);
    expect(d.photos).toEqual(['https://a/1']);
  });

  it('only allows accepting an active, unexpired quote on an open request', () => {
    const r = toPartRequestSummary({ ...core, quoteCount: 1, bestPriceHalalas: 8550 });
    const q = toPartQuote(quote(), NOW);
    expect(canAccept(r, q, NOW)).toBe(true);
    expect(canAccept({ ...r, status: 'accepted' }, q, NOW)).toBe(false);
    expect(canAccept(r, { ...q, expired: true }, NOW)).toBe(false);
    expect(canAccept(r, { ...q, status: 'withdrawn' }, NOW)).toBe(false);
    expect(canAccept({ ...r, expiresAt: NOW - 1 }, q, NOW)).toBe(false);
  });

  it('accepts JPEG/PNG photos only', () => {
    expect(photoContentType('image/jpeg', 'file:///a')).toBe('image/jpeg');
    expect(photoContentType('image/jpg', 'file:///a')).toBe('image/jpeg');
    expect(photoContentType(null, 'file:///a/b.PNG')).toBe('image/png');
    expect(photoContentType(undefined, 'file:///a/b.jpeg')).toBe('image/jpeg');
    expect(photoContentType('image/heic', 'file:///a/b.heic')).toBeNull();
  });
});

const privateProduct: ApiProduct = {
  id: 'p-draft-1',
  name: { ar: 'حساس أكسجين', en: 'Oxygen sensor' },
  description: { ar: '', en: '' },
  categoryId: 'engine',
  brand: 'Motorcraft',
  origin: 'oem',
  partNumber: 'DG9Z-9G444-A',
  oemReferences: [],
  specs: [],
  fitment: [{ modelId: 'taurus', yearFrom: 2021, yearTo: 2021, source: 'seller' }],
  art: 'sparkPlug',
  keywords: [],
  rating: null,
  offers: [
    { id: 'o-private', productId: 'p-draft-1', sellerId: 's-salvage', priceHalalas: 8550, compareAtHalalas: null, available: 1, condition: 'used', warrantyMonths: 1, dispatchDays: [0, 1], originCity: 'riyadh', noteAr: 'مفحوص', noteEn: 'مفحوص' },
  ],
};
const seller: ApiSeller = { id: 's-salvage', name: { ar: 'تشليح', en: 'Salvage' }, city: 'riyadh', verifiedBusiness: true, joinedYear: 2020, rating: null, fulfilledOrders: 0, onTimeRate: null, responseHours: 2, supportsWorkshopDelivery: false, specialty: { ar: '', en: '' } };

describe('private offers in the remote catalog', () => {
  beforeEach(() => {
    clearPrivateCatalog();
    setCatalogData({ products: [], offers: [], sellers: [], makes: [], categories: [] });
  });

  it('adapts the accept response / private-offers payload (null entries tolerated)', () => {
    const c = toPrivateCatalog({ products: [privateProduct, null], sellers: [seller, null] }, () => 'sparkPlug');
    expect(c.products.map((p) => p.id)).toEqual(['p-draft-1']);
    expect(c.offers[0]).toMatchObject({ id: 'o-private', price: 85.5, stock: 1, condition: 'used' });
    expect(c.sellers[0].id).toBe('s-salvage');
  });

  it('exposes private offers to lookups only (cart/checkout), never to product offer lists', () => {
    addPrivateCatalog(toPrivateCatalog({ products: [privateProduct], sellers: [seller] }));
    const idx = catalogIndex();
    expect(idx.offers.get('o-private')?.price).toBe(85.5);
    expect(idx.products.get('p-draft-1')?.brand).toBe('Motorcraft');
    expect(idx.sellers.get('s-salvage')).toBeDefined();
    expect(idx.offersByProduct.get('p-draft-1')).toBeUndefined();
    expect(useRemoteCatalog.getState().offers).toHaveLength(0);
    expect(isPrivateOffer('o-private')).toBe(true);
  });

  it('survives a public catalog refresh', () => {
    addPrivateCatalog(toPrivateCatalog({ products: [privateProduct], sellers: [seller] }));
    setCatalogData({ products: [], offers: [], sellers: [] });
    expect(catalogIndex().offers.get('o-private')).toBeDefined();
  });

  it('keeps an offer still in the cart but gone server-side, flagged unavailable; drops the rest', () => {
    addPrivateCatalog(toPrivateCatalog({ products: [privateProduct], sellers: [seller] }));
    setPrivateCatalog({ products: [], offers: [], sellers: [] }, ['o-private']);
    const o = catalogIndex().offers.get('o-private');
    expect(o?.unavailable).toBe(true);
    expect(o?.stock).toBe(0);
    expect(catalogIndex().products.get('p-draft-1')).toBeDefined();
    setPrivateCatalog({ products: [], offers: [], sellers: [] }, []);
    expect(catalogIndex().offers.get('o-private')).toBeUndefined();
  });
});
