import { fromAddress, toAddress, toOffer, toProduct, toSeller, toVehicle } from '@/api/adapters';
import type { ApiOffer, ApiProduct, ReferenceResponse, SnapshotResponse } from '@/api/types';
import { getFitStatus } from '@/domain/compatibility';
import { buildCatalog } from '@/services/remote/catalogSync';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const apiOffer: ApiOffer = {
  id: 'o-002',
  productId: 'p-camry-pads-oem',
  sellerId: 's-brake-house',
  priceHalalas: 36500,
  compareAtHalalas: 41000,
  available: 3,
  condition: 'new',
  warrantyMonths: 12,
  dispatchDays: [1, 2],
  originCity: 'makkah',
  noteAr: null,
  noteEn: null,
};

const apiProduct: ApiProduct = {
  id: 'p-camry-pads-ceramic',
  name: { ar: 'فحمات سيراميك', en: 'Ceramic pads' },
  description: { ar: 'وصف', en: 'Description' },
  categoryId: 'brakes',
  brand: 'Torvik',
  origin: 'aftermarket',
  partNumber: 'TRV-D2210C',
  oemReferences: ['04465-X3301'],
  specs: [{ label: { ar: 'الموضع', en: 'Position' }, value: { ar: 'أمامي', en: 'Front' } }, { label: { ar: 'عدد', en: 'Pieces' }, value: '4' }, { bogus: true }],
  fitment: [
    { modelId: 'camry', yearFrom: 2018, yearTo: 2025, source: 'catalog' },
    { modelId: 'altima', yearFrom: 2019, yearTo: 2025, source: 'seller' },
    { modelId: 'sunny', yearFrom: 2018, yearTo: 2025, source: 'SOMETHING_NEW' },
  ],
  art: 'pads',
  keywords: ['brake'],
  rating: null,
  offers: [apiOffer],
};

describe('API → domain adapters', () => {
  it('maps an offer: halalas → SAR, live availability → stock, origin city', () => {
    const o = toOffer(apiOffer);
    expect(o).toMatchObject({ id: 'o-002', price: 365, compareAtPrice: 410, stock: 3, condition: 'new', dispatchDays: [1, 2], originCity: 'makkah', deliveryOptions: [] });
    expect(o.unavailable).toBeUndefined();
  });

  it('treats a non-purchasable offer as out of stock and flags it', () => {
    const o = toOffer({ ...apiOffer, purchasable: false, available: 9 });
    expect(o.stock).toBe(0);
    expect(o.unavailable).toBe(true);
  });

  it('never presents an unknown condition as new, and drops a compare-at price that is not higher', () => {
    const o = toOffer({ ...apiOffer, condition: 'MYSTERY', compareAtHalalas: 30000, available: -2 });
    expect(o.condition).toBe('used');
    expect(o.compareAtPrice).toBeUndefined();
    expect(o.stock).toBe(0);
  });

  it('maps a product with null rating, valid specs only and conservative fitment sources', () => {
    const p = toProduct(apiProduct);
    expect(p.rating).toBeNull();
    expect(p.specs).toHaveLength(2);
    expect(p.fitment.map((f) => f.source)).toEqual(['catalog', 'seller', 'seller']);
    const camry = { id: 'v', makeId: 'toyota', modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4', addedAt: 0 };
    expect(getFitStatus(p, camry)).toBe('catalogMatch');
    expect(getFitStatus(p, { ...camry, modelId: 'sunny' })).toBe('sellerReported');
    expect(getFitStatus(p, { ...camry, year: 2016 })).toBe('noData');
  });

  it('falls back to a safe illustration for unknown art', () => {
    expect(toProduct({ ...apiProduct, art: 'hologram' }, 'rotor').art).toBe('rotor');
  });

  it('maps sellers without inventing ratings', () => {
    const s = toSeller({ id: 's-x', name: { ar: 'تاجر', en: 'Trader' }, city: 'riyadh', verifiedBusiness: true, joinedYear: 2021, rating: null, fulfilledOrders: 0, onTimeRate: null, responseHours: 2, supportsWorkshopDelivery: false, specialty: { ar: 'أ', en: 'a' } });
    expect(s.rating).toBeNull();
    expect(s.freeShippingOver).toBeUndefined();
    expect(s.city).toBe('riyadh');
  });

  it('maps garage vehicles using the reference data for the make', () => {
    const v = toVehicle({ id: 'gv1', modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4', addedAt: 1 }, (m) => (m === 'camry' ? 'toyota' : undefined));
    expect(v).toMatchObject({ id: 'gv1', makeId: 'toyota', modelId: 'camry' });
  });

  it('round-trips addresses and omits empty optional fields on the way out', () => {
    const a = toAddress({ id: 'a1', kind: 'workshop', label: 'ورشة', city: 'jeddah', district: 'الروضة', street: 'شارع 1', contactName: 'سارة', phone: '+966500000001', workshopName: 'ورشة الأمانة' });
    expect(a.kind).toBe('workshop');
    const out = fromAddress({ ...a, kind: 'home', details: '' });
    expect(out).not.toHaveProperty('workshopName');
    expect(out).not.toHaveProperty('details');
  });

  it('builds the catalog from reference + snapshot', () => {
    const reference: ReferenceResponse = {
      categories: [{ id: 'brakes', name: { ar: 'الفرامل', en: 'Brakes' }, art: 'rotor' }],
      makes: [{ id: 'toyota', name: { ar: 'تويوتا', en: 'Toyota' }, models: [{ id: 'camry', makeId: 'toyota', name: { ar: 'كامري', en: 'Camry' }, yearFrom: 2018, yearTo: 2025, trims: ['GLE'], engines: ['2.5L I4'] }] }],
    };
    const snapshot: SnapshotResponse = { generatedAt: '', products: [apiProduct], sellers: [] };
    const data = buildCatalog(reference, snapshot);
    expect(data.products.map((p) => p.id)).toEqual(['p-camry-pads-ceramic']);
    expect(data.offers.map((o) => o.price)).toEqual([365]);
    expect(data.makes[0].models[0].trims).toEqual(['GLE']);
  });
});
