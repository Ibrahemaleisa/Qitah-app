import { toDeliveryEstimate } from '@/api/adapters';
import { arrivalLabel, bestDeliveredOffer, deliveredPrice, deliveredScores, riyadhToday, type DeliveryEstimate } from '@/domain/deliveredPrice';
import { offerHighlights } from '@/domain/offerComparison';
import type { Offer } from '@/domain/types';
import { arrivalText } from '@/features/arrival';
import ar from '@/i18n/ar';
import en from '@/i18n/en';

const offer = (id: string, price: number, stock = 5): Offer => ({
  id,
  productId: 'p',
  sellerId: 's-riyadh-center',
  price,
  stock,
  condition: 'new',
  warrantyMonths: 0,
  dispatchDays: [0, 1],
  deliveryOptions: [],
});

const est = (offerId: string, fee: number, etaMax: number, arrivesBy: string, sameDay = false): DeliveryEstimate => ({
  offerId,
  cheapest: { service: 'standard', fee, etaDays: [etaMax, etaMax], arrivesBy },
  fastest: { service: sameDay ? 'sameDay' : 'express', fee: fee + 10, etaDays: [sameDay ? 0 : etaMax, sameDay ? 0 : etaMax], arrivesBy: sameDay ? '2026-10-28' : arrivesBy },
  sameDayAvailable: sameDay,
  cutoffLocal: '14:00',
});

describe('delivered price mapping', () => {
  it('maps the server estimate (halalas) to SAR without float drift', () => {
    const e = toDeliveryEstimate({
      offerId: 'o-1',
      cheapest: { service: 'standard', amountHalalas: 1800, etaDaysMin: 1, etaDaysMax: 3, arrivesBy: '2026-10-31' },
      fastest: { service: 'sameDay', amountHalalas: 3500, etaDaysMin: 0, etaDaysMax: 0, arrivesBy: '2026-10-28' },
      sameDayAvailable: true,
      cutoffLocal: '14:00',
    });
    expect(e.cheapest).toEqual({ service: 'standard', fee: 18, etaDays: [1, 3], arrivesBy: '2026-10-31' });
    expect(e.sameDayAvailable).toBe(true);
    const d = deliveredPrice({ price: 19.99 }, e)!;
    expect(d.total).toBe(37.99);
    expect(d.fee).toBe(18);
    expect(d.arrivesBy).toBe('2026-10-28');
    expect(d.arrivesToday).toBe(true);
  });

  it('drops malformed services instead of guessing, and claims same-day only when the fastest really is today', () => {
    const e = toDeliveryEstimate({ offerId: 'o-2', cheapest: { service: 'standard', amountHalalas: 1500, etaDaysMin: 1, etaDaysMax: 2, arrivesBy: 'soon' }, fastest: null, sameDayAvailable: true, cutoffLocal: '14:00' });
    expect(e.cheapest).toBeNull();
    expect(e.sameDayAvailable).toBe(false);
    expect(deliveredPrice({ price: 10 }, e)).toBeNull();
    expect(deliveredPrice({ price: 10 }, undefined)).toBeNull();
  });

  it('labels arrival as today / tomorrow / weekday / date in Riyadh time', () => {
    expect(riyadhToday(Date.parse('2026-10-28T20:59:00Z'))).toBe('2026-10-28');
    expect(riyadhToday(Date.parse('2026-10-28T21:00:00Z'))).toBe('2026-10-29');
    expect(arrivalLabel('2026-10-28', '2026-10-28')).toEqual({ kind: 'today' });
    expect(arrivalLabel('2026-10-29', '2026-10-28')).toEqual({ kind: 'tomorrow' });
    expect(arrivalLabel('2026-11-01', '2026-10-28')).toEqual({ kind: 'weekday', weekday: 0 });
    expect(arrivalLabel('2026-11-10', '2026-10-28')).toEqual({ kind: 'date', date: '2026-11-10' });
    const now = Date.parse('2026-10-28T08:00:00Z'); // Wednesday 11:00 Riyadh
    expect(arrivalText(ar, '2026-10-28', now)).toBe('يصلك اليوم');
    expect(arrivalText(ar, '2026-10-29', now)).toBe('يصلك غداً');
    expect(arrivalText(ar, '2026-11-01', now)).toBe('يصلك الأحد');
    expect(arrivalText(en, '2026-11-01', now)).toBe('Arrives Sunday');
  });

  it('"best price" is the lowest delivered total, not the lowest item price', () => {
    const near = offer('near', 100); // same city: cheap delivery
    const far = offer('far', 95); // cheaper part, expensive cross-country delivery
    const estimates = { near: est('near', 15, 1, '2026-10-29', true), far: est('far', 29, 5, '2026-11-02') };
    expect(bestDeliveredOffer([near, far], estimates)?.id).toBe('near');
    // Without estimates it falls back to item price.
    expect(bestDeliveredOffer([near, far], {})?.id).toBe('far');
    // Highlights follow the same rule.
    const h = offerHighlights([near, far], 'home', 'riyadh', deliveredScores(estimates));
    expect(h.near?.map((x) => x.kind)).toEqual(['cheapest', 'fastest']);
    expect(h.far).toBeUndefined();
    expect(deliveredScores({})).toEqual({});
  });

  it('skips out-of-stock offers when picking the best delivered price', () => {
    const a = offer('a', 50, 0);
    const b = offer('b', 80);
    expect(bestDeliveredOffer([a, b], { a: est('a', 10, 1, '2026-10-29'), b: est('b', 10, 1, '2026-10-29') })?.id).toBe('b');
  });
});
