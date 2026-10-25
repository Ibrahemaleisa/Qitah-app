import { offersForProduct } from '@/data/offers';
import { offerHighlights } from '@/domain/offerComparison';

describe('offerHighlights', () => {
  it('never compares offers across conditions', () => {
    // Land Cruiser alternator: 1 new, 1 refurbished, 1 used — no condition has two offers.
    const h = offerHighlights(offersForProduct('p-lc-alternator'));
    expect(Object.keys(h)).toHaveLength(0);
  });

  it('labels badges with the condition when a list mixes conditions', () => {
    // Elantra strut: 1 new + 1 used → nothing comparable; Camry pads: 3 new → plain badges.
    const pads = offerHighlights(offersForProduct('p-camry-pads-oem'));
    const all = Object.values(pads).flat();
    expect(all.some((x) => x.kind === 'cheapest')).toBe(true);
    expect(all.every((x) => x.condition === undefined)).toBe(true);
  });

  it('awards cheapest by estimated total including delivery', () => {
    const pads = offerHighlights(offersForProduct('p-camry-pads-oem'));
    const cheapestId = Object.entries(pads).find(([, hs]) => hs.some((x) => x.kind === 'cheapest'))?.[0];
    expect(cheapestId).toBe('o-002'); // 365 SAR + free delivery (Brake House threshold 300)
  });

  it('ignores out-of-stock offers', () => {
    const rotor = offerHighlights(offersForProduct('p-lc-rotor-slotted')); // one offer is out of stock
    expect(Object.keys(rotor)).toHaveLength(0);
  });
});
