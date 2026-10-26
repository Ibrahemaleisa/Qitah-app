import { isRemote } from '@/config/env';
import { getOffer } from '@/data/offers';
import { getSeller as getSellerById, deliveryOptions } from '@/data/sellers';

import type {
  CartLine,
  CityId,
  DeliveryDestination,
  DeliveryOption,
  DeliveryOptionId,
  Offer,
  Seller,
} from './types';

export const VAT_RATE = 0.15;

/** Prices are VAT-inclusive (Saudi consumer pricing); this extracts the VAT portion. */
export function vatIncluded(total: number): number {
  return Math.round((total - total / (1 + VAT_RATE)) * 100) / 100;
}

export function getSeller(id: string): Seller | undefined {
  return getSellerById(id);
}

/** Delivery options a seller can actually offer for a given destination. */
export function availableDeliveryOptions(
  offerOptions: DeliveryOptionId[],
  seller: Seller,
  destination: DeliveryDestination,
  city: CityId | undefined,
): DeliveryOption[] {
  if (destination === 'workshop' && !seller.supportsWorkshopDelivery) return [];
  return offerOptions
    .map((id) => deliveryOptions[id])
    .filter((option) => !option.sameCityOnly || city === undefined || city === seller.city);
}

export function cheapestDelivery(offer: Offer, destination: DeliveryDestination = 'home', city?: CityId): DeliveryOption | undefined {
  const seller = getSeller(offer.sellerId);
  if (!seller) return undefined;
  const options = availableDeliveryOptions(offer.deliveryOptions, seller, destination, city);
  return options.sort((a, b) => a.fee - b.fee)[0];
}

export function fastestDelivery(offer: Offer, destination: DeliveryDestination = 'home', city?: CityId): DeliveryOption | undefined {
  const seller = getSeller(offer.sellerId);
  if (!seller) return undefined;
  const options = availableDeliveryOptions(offer.deliveryOptions, seller, destination, city);
  return options.sort((a, b) => a.etaDays[1] - b.etaDays[1])[0];
}

export type EstimatedTotal = {
  total: number;
  fee: number;
  delivery: DeliveryOption | undefined;
  freeShipping: boolean;
  /** Remote mode: shipping is a live carrier quote computed at checkout, so no fee is estimated here. */
  quotedAtCheckout: boolean;
  /** False when the seller cannot deliver to this destination (e.g. workshops). */
  deliverable: boolean;
};

/** Estimated total for a single unit: price plus the cheapest available delivery fee. */
export function estimatedTotal(offer: Offer, destination: DeliveryDestination = 'home', city?: CityId): EstimatedTotal {
  const seller = getSeller(offer.sellerId);
  if (isRemote) {
    // Never invent a shipping fee client-side: the server quotes it per shipment at checkout.
    const deliverable = !!seller && (destination !== 'workshop' || seller.supportsWorkshopDelivery);
    return { total: offer.price, fee: 0, delivery: undefined, freeShipping: false, quotedAtCheckout: true, deliverable };
  }
  const delivery = cheapestDelivery(offer, destination, city);
  const freeShipping = !!seller?.freeShippingOver && offer.price >= seller.freeShippingOver;
  const fee = delivery ? (freeShipping ? 0 : delivery.fee) : 0;
  return { total: offer.price + fee, fee, delivery, freeShipping, quotedAtCheckout: false, deliverable: !!delivery };
}

/** Earliest and latest delivery days including seller dispatch time. */
export function deliveryWindow(offer: Offer, option: DeliveryOption): [number, number] {
  return [offer.dispatchDays[0] + option.etaDays[0], offer.dispatchDays[1] + option.etaDays[1]];
}

export type SellerGroup = {
  seller: Seller;
  lines: { line: CartLine; offer: Offer }[];
  subtotal: number;
  /** Delivery options shared by every offer in this group. */
  deliveryOptions: DeliveryOption[];
};

/** Groups a multi-seller cart into one shipment per seller. */
export function groupCartBySeller(
  lines: CartLine[],
  destination: DeliveryDestination,
  city: CityId | undefined,
): SellerGroup[] {
  const groups = new Map<string, SellerGroup>();
  for (const line of lines) {
    const offer = getOffer(line.offerId);
    if (!offer) continue;
    const seller = getSeller(offer.sellerId);
    if (!seller) continue;
    let group = groups.get(seller.id);
    if (!group) {
      group = { seller, lines: [], subtotal: 0, deliveryOptions: [] };
      groups.set(seller.id, group);
    }
    group.lines.push({ line, offer });
    group.subtotal += offer.price * line.qty;
  }
  for (const group of groups.values()) {
    if (destination === 'workshop' && !group.seller.supportsWorkshopDelivery) {
      group.deliveryOptions = [];
      continue;
    }
    const optionSets = group.lines.map(({ offer }) =>
      availableDeliveryOptions(offer.deliveryOptions, group.seller, destination, city).map((o) => o.id),
    );
    const shared = optionSets.reduce<DeliveryOptionId[]>(
      (acc, ids) => acc.filter((id) => ids.includes(id)),
      optionSets[0] ?? [],
    );
    // If items need different methods (e.g. freight + parcel), fall back to the slowest common carrier.
    const ids: DeliveryOptionId[] = shared.length > 0 ? shared : optionSets.flat().includes('freight') ? ['freight'] : ['standard'];
    group.deliveryOptions = ids.map((id) => deliveryOptions[id]).sort((a, b) => a.fee - b.fee);
  }
  return [...groups.values()];
}

export function shippingFeeFor(group: SellerGroup, option: DeliveryOption): number {
  if (group.seller.freeShippingOver && group.subtotal >= group.seller.freeShippingOver && option.id !== 'sameDay') {
    return 0;
  }
  return option.fee;
}
