import { getOffer } from '@/data/offers';
import { availableDeliveryOptions, estimatedTotal, getSeller, groupCartBySeller, shippingFeeFor, vatIncluded } from '@/domain/pricing';

describe('pricing', () => {
  it('extracts VAT from VAT-inclusive totals', () => {
    expect(vatIncluded(115)).toBe(15);
  });

  it('adds the cheapest delivery to the estimated total', () => {
    const offer = getOffer('o-003')!; // Eastern Parts, 372 SAR, no free-shipping threshold
    expect(estimatedTotal(offer).total).toBe(372 + 25);
  });

  it('applies the seller free-shipping threshold', () => {
    const offer = getOffer('o-001')!; // Riyadh Parts Center, 389 SAR, free over 400
    expect(estimatedTotal(offer).freeShipping).toBe(false);
    const big = getOffer('o-007')!; // 745 SAR
    expect(estimatedTotal(big).freeShipping).toBe(true);
    expect(estimatedTotal(big).fee).toBe(0);
  });

  it('only offers same-day delivery within the seller city', () => {
    const offer = getOffer('o-001')!;
    const seller = getSeller(offer.sellerId)!;
    const riyadh = availableDeliveryOptions(offer.deliveryOptions, seller, 'home', 'riyadh').map((o) => o.id);
    const jeddah = availableDeliveryOptions(offer.deliveryOptions, seller, 'home', 'jeddah').map((o) => o.id);
    expect(riyadh).toContain('sameDay');
    expect(jeddah).not.toContain('sameDay');
  });

  it('splits a multi-seller cart into one group per seller', () => {
    const groups = groupCartBySeller([{ offerId: 'o-001', qty: 1 }, { offerId: 'o-025', qty: 2 }, { offerId: 'o-013', qty: 1 }], 'home', 'riyadh');
    expect(groups).toHaveLength(2);
    const riyadh = groups.find((g) => g.seller.id === 's-riyadh-center')!;
    expect(riyadh.subtotal).toBe(389 + 38);
    expect(shippingFeeFor(riyadh, riyadh.deliveryOptions[0])).toBe(0); // 427 >= 400 threshold
  });

  it('blocks workshop delivery for sellers that do not support it', () => {
    const groups = groupCartBySeller([{ offerId: 'o-008', qty: 1 }], 'workshop', 'riyadh'); // salvage market
    expect(groups[0].deliveryOptions).toHaveLength(0);
  });
});
