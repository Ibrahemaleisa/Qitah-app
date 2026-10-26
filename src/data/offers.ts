import { catalogIndex, useRemoteCatalog } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import type { Condition, DeliveryOptionId, L10n, Offer } from '@/domain/types';

type OfferInput = {
  price: number;
  stock: number;
  condition?: Condition;
  warranty?: number;
  dispatch?: [number, number];
  delivery?: DeliveryOptionId[];
  compareAt?: number;
  note?: L10n;
};

const STD: DeliveryOptionId[] = ['standard', 'express', 'sameDay'];
const FREIGHT: DeliveryOptionId[] = ['freight'];

let seq = 0;
function o(productId: string, sellerId: string, input: OfferInput): Offer {
  seq += 1;
  return {
    id: `o-${seq.toString().padStart(3, '0')}`,
    productId,
    sellerId,
    price: input.price,
    compareAtPrice: input.compareAt,
    stock: input.stock,
    condition: input.condition ?? 'new',
    warrantyMonths: input.warranty ?? 0,
    dispatchDays: input.dispatch ?? [0, 1],
    deliveryOptions: input.delivery ?? STD,
    note: input.note,
  };
}

/** SAMPLE DATA — fictional seller offers. Prices are in SAR and include VAT. */
export const offers: Offer[] = [
  o('p-camry-pads-oem', 's-riyadh-center', { price: 389, stock: 14, warranty: 12 }),
  o('p-camry-pads-oem', 's-brake-house', { price: 365, stock: 3, warranty: 12, dispatch: [1, 2], compareAt: 410 }),
  o('p-camry-pads-oem', 's-eastern', { price: 372, stock: 8, warranty: 6, dispatch: [1, 2], delivery: ['standard', 'express'] }),

  o('p-camry-pads-ceramic', 's-brake-house', { price: 219, stock: 22, warranty: 12 }),
  o('p-camry-pads-ceramic', 's-eastern', { price: 205, stock: 6, warranty: 6, dispatch: [1, 3], delivery: ['standard'] }),
  o('p-camry-pads-ceramic', 's-quickfix', { price: 189, stock: 2, warranty: 3, dispatch: [2, 3], delivery: ['standard'] }),

  o('p-lc-rotor-oem', 's-riyadh-center', { price: 745, stock: 5, warranty: 12 }),
  o('p-lc-rotor-oem', 's-salvage', { price: 380, stock: 1, condition: 'used', warranty: 1, dispatch: [1, 2], delivery: ['standard', 'sameDay'], note: { ar: 'مفحوص — سماكة ضمن الحد المسموح', en: 'Inspected — thickness within spec' } }),

  o('p-lc-rotor-slotted', 's-brake-house', { price: 520, stock: 9, warranty: 12, compareAt: 590 }),
  o('p-lc-rotor-slotted', 's-eastern', { price: 498, stock: 0, warranty: 12, dispatch: [2, 4], delivery: ['standard'] }),

  o('p-tahoe-pads-rear', 's-brake-house', { price: 265, stock: 11, warranty: 12 }),
  o('p-tahoe-pads-rear', 's-eastern', { price: 249, stock: 4, warranty: 6, dispatch: [1, 2], delivery: ['standard', 'express'] }),

  o('p-toyota-oil-filter', 's-riyadh-center', { price: 38, stock: 120, warranty: 0 }),
  o('p-toyota-oil-filter', 's-elite-oils', { price: 34, stock: 300, warranty: 0 }),
  o('p-toyota-oil-filter', 's-eastern', { price: 36, stock: 45, dispatch: [1, 2], delivery: ['standard'] }),

  o('p-oil-filter-kanzen', 's-elite-oils', { price: 27, stock: 180 }),
  o('p-oil-filter-kanzen', 's-quickfix', { price: 24, stock: 12, dispatch: [1, 3], delivery: ['standard'] }),

  o('p-camry-air-filter', 's-riyadh-center', { price: 79, stock: 40 }),
  o('p-camry-air-filter', 's-elite-oils', { price: 72, stock: 65 }),

  o('p-cabin-filter-hk', 's-elite-oils', { price: 59, stock: 90, compareAt: 75 }),
  o('p-cabin-filter-hk', 's-eastern', { price: 55, stock: 30, dispatch: [1, 2], delivery: ['standard'] }),
  o('p-cabin-filter-hk', 's-quickfix', { price: 49, stock: 7, dispatch: [2, 3], delivery: ['standard'] }),

  o('p-patrol-air-filter', 's-elite-oils', { price: 95, stock: 25 }),
  o('p-patrol-air-filter', 's-eastern', { price: 89, stock: 10, dispatch: [1, 2] }),

  o('p-oil-5w30', 's-elite-oils', { price: 149, stock: 220, compareAt: 175 }),
  o('p-oil-5w30', 's-eastern', { price: 155, stock: 60, dispatch: [1, 2] }),
  o('p-oil-5w30', 's-riyadh-center', { price: 159, stock: 34 }),

  o('p-oil-0w20-oem', 's-riyadh-center', { price: 135, stock: 80 }),
  o('p-oil-0w20-oem', 's-elite-oils', { price: 129, stock: 140 }),

  o('p-coolant', 's-elite-oils', { price: 45, stock: 150 }),
  o('p-coolant', 's-quickfix', { price: 42, stock: 18, dispatch: [1, 2], delivery: ['standard'] }),

  o('p-spark-iridium', 's-eastern', { price: 168, stock: 26, warranty: 12 }),
  o('p-spark-iridium', 's-elite-oils', { price: 175, stock: 40, warranty: 12 }),
  o('p-spark-iridium', 's-quickfix', { price: 152, stock: 5, warranty: 6, dispatch: [2, 3], delivery: ['standard'] }),

  o('p-f150-belt', 's-eastern', { price: 139, stock: 7, warranty: 6 }),

  o('p-accent-water-pump', 's-eastern', { price: 215, stock: 9, warranty: 12 }),
  o('p-accent-water-pump', 's-salvage', { price: 95, stock: 2, condition: 'used', warranty: 1, dispatch: [1, 2], delivery: ['standard'] }),

  o('p-patrol-radiator', 's-riyadh-center', { price: 1890, stock: 2, warranty: 12, dispatch: [1, 3], delivery: FREIGHT }),
  o('p-patrol-radiator', 's-salvage', { price: 890, stock: 1, condition: 'refurbished', warranty: 3, dispatch: [2, 4], delivery: FREIGHT, note: { ar: 'مجدد — تم اختبار الضغط', en: 'Refurbished — pressure tested' } }),

  o('p-battery-70', 's-quickfix', { price: 435, stock: 6, warranty: 18, dispatch: [1, 2], delivery: ['standard', 'sameDay'] }),
  o('p-battery-70', 's-eastern', { price: 459, stock: 20, warranty: 24 }),
  o('p-battery-70', 's-elite-oils', { price: 449, stock: 15, warranty: 18 }),

  o('p-battery-100', 's-eastern', { price: 649, stock: 8, warranty: 24 }),
  o('p-battery-100', 's-quickfix', { price: 615, stock: 2, warranty: 18, dispatch: [1, 3], delivery: ['standard'] }),

  o('p-lc-alternator', 's-riyadh-center', { price: 2450, stock: 2, warranty: 12, dispatch: [1, 2] }),
  o('p-lc-alternator', 's-salvage', { price: 1150, stock: 1, condition: 'refurbished', warranty: 6, dispatch: [1, 2], delivery: ['standard'] }),
  o('p-lc-alternator', 's-salvage', { price: 690, stock: 1, condition: 'used', warranty: 1, dispatch: [1, 2], delivery: ['standard'], note: { ar: 'مستعمل — مسافة تقريبية 90 ألف كم', en: 'Used — approx. 90,000 km' } }),

  o('p-camry-headlight', 's-quickfix', { price: 980, stock: 3, warranty: 12, dispatch: [2, 4], delivery: ['standard'] }),
  o('p-camry-headlight', 's-eastern', { price: 1040, stock: 5, warranty: 12 }),

  o('p-h11-led', 's-quickfix', { price: 119, stock: 30, warranty: 12 }),
  o('p-h11-led', 's-eastern', { price: 129, stock: 14, warranty: 6, dispatch: [1, 2] }),

  o('p-hilux-shock', 's-brake-house', { price: 329, stock: 12, warranty: 12 }),
  o('p-hilux-shock', 's-eastern', { price: 309, stock: 4, warranty: 6, dispatch: [1, 3], delivery: ['standard'] }),

  o('p-elantra-strut-oem', 's-eastern', { price: 690, stock: 3, warranty: 12, dispatch: [1, 2] }),
  o('p-elantra-strut-oem', 's-salvage', { price: 320, stock: 1, condition: 'used', warranty: 1, dispatch: [1, 2], delivery: ['standard'] }),

  o('p-sonata-mirror', 's-salvage', { price: 540, stock: 2, condition: 'used', warranty: 1, delivery: ['standard', 'sameDay'], note: { ar: 'خدوش بسيطة على الغطاء', en: 'Minor scuffs on the cover' } }),
  o('p-sonata-mirror', 's-eastern', { price: 1180, stock: 2, warranty: 12, dispatch: [2, 4], delivery: ['standard'] }),

  o('p-hilux-bumper', 's-riyadh-center', { price: 1320, stock: 1, warranty: 12, dispatch: [1, 3], delivery: FREIGHT }),
];

export function allOffers(): Offer[] {
  return isRemote ? useRemoteCatalog.getState().offers : offers;
}

export function offersForProduct(productId: string): Offer[] {
  if (isRemote) return [...(catalogIndex().offersByProduct.get(productId) ?? [])];
  return offers.filter((offer) => offer.productId === productId);
}

const offerIndex = new Map(offers.map((offer) => [offer.id, offer]));

export function getOffer(id: string): Offer | undefined {
  return isRemote ? catalogIndex().offers.get(id) : offerIndex.get(id);
}
