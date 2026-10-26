/**
 * The data accessors (`getProduct`, `getOffer`, `getSeller`, …) read the live catalog in remote mode
 * and the bundled SAMPLE data otherwise. Remote mode is decided at import time from
 * EXPO_PUBLIC_API_BASE_URL, so each case loads the modules in isolation.
 */
import type { Offer, Product } from '@/domain/types';

function load(remote: boolean) {
  const prev = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (remote) process.env.EXPO_PUBLIC_API_BASE_URL = 'http://api.test';
  else delete process.env.EXPO_PUBLIC_API_BASE_URL;
  let mods!: {
    catalog: typeof import('@/data/catalog');
    offers: typeof import('@/data/offers');
    sellers: typeof import('@/data/sellers');
    reviews: typeof import('@/data/reviews');
    remote: typeof import('@/catalog/remote-catalog');
    pricing: typeof import('@/domain/pricing');
  };
  jest.isolateModules(() => {
    /* eslint-disable @typescript-eslint/no-require-imports -- isolateModules needs synchronous require */
    mods = {
      catalog: require('@/data/catalog'),
      offers: require('@/data/offers'),
      sellers: require('@/data/sellers'),
      reviews: require('@/data/reviews'),
      remote: require('@/catalog/remote-catalog'),
      pricing: require('@/domain/pricing'),
    };
    /* eslint-enable @typescript-eslint/no-require-imports */
  });
  if (prev === undefined) delete process.env.EXPO_PUBLIC_API_BASE_URL;
  else process.env.EXPO_PUBLIC_API_BASE_URL = prev;
  return mods;
}

const liveProduct: Product = {
  id: 'p-live',
  name: { ar: 'قطعة', en: 'Part' },
  categoryId: 'brakes',
  brand: 'B',
  origin: 'oem',
  partNumber: 'X-1',
  oemReferences: [],
  description: { ar: '', en: '' },
  specs: [],
  fitment: [],
  art: 'pads',
  keywords: [],
  rating: null,
};
const liveOffer: Offer = { id: 'o-live', productId: 'p-live', sellerId: 's-live', price: 99.5, stock: 4, condition: 'new', warrantyMonths: 0, dispatchDays: [0, 1], deliveryOptions: [] };

describe('catalog accessors', () => {
  it('demo mode reads the bundled sample data', () => {
    const m = load(false);
    expect(m.catalog.getProduct('p-camry-pads-oem')).toBeDefined();
    expect(m.offers.getOffer('o-001')?.price).toBe(389);
    expect(m.reviews.reviewsForProduct('p-camry-pads-oem').length).toBeGreaterThan(0);
  });

  it('remote mode reads the live catalog, shows no sample reviews and quotes shipping at checkout', () => {
    const m = load(true);
    expect(m.catalog.getProduct('p-camry-pads-oem')).toBeUndefined();
    m.remote.setCatalogData({
      products: [liveProduct],
      offers: [liveOffer],
      sellers: [{ id: 's-live', name: { ar: 'تاجر', en: 'Seller' }, city: 'riyadh', verifiedBusiness: true, joinedYear: 2024, rating: null, fulfilledOrders: 0, onTimeRate: null, responseHours: 1, supportsWorkshopDelivery: false, specialty: { ar: '', en: '' } }],
    });
    expect(m.catalog.getProduct('p-live')?.name.en).toBe('Part');
    expect(m.catalog.allProducts()).toHaveLength(1);
    expect(m.offers.offersForProduct('p-live').map((o) => o.id)).toEqual(['o-live']);
    expect(m.sellers.getSeller('s-live')?.rating).toBeNull();
    expect(m.reviews.reviewsForProduct('p-camry-pads-oem')).toEqual([]);

    const est = m.pricing.estimatedTotal(liveOffer, 'home');
    expect(est).toMatchObject({ total: 99.5, fee: 0, quotedAtCheckout: true, deliverable: true });
    expect(m.pricing.estimatedTotal(liveOffer, 'workshop').deliverable).toBe(false);

    // Live stock refresh merges into the same accessors.
    m.remote.mergeOffers([{ ...liveOffer, stock: 0, unavailable: true }]);
    expect(m.offers.getOffer('o-live')).toMatchObject({ stock: 0, unavailable: true });
  });
});
