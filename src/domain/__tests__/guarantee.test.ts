import { guaranteeState, isGuaranteedFit, returnShippingPayer } from '@/domain/guarantee';
import type { Product, Vehicle } from '@/domain/types';
import { toOrderView } from '@/services/remote/orderView';

const base: Product = {
  id: 'p',
  name: { ar: 'فحمات', en: 'Pads' },
  categoryId: 'brakes',
  brand: 'X',
  origin: 'oem',
  partNumber: 'PN-1',
  oemReferences: [],
  description: { ar: '', en: '' },
  specs: [],
  fitment: [],
  art: 'pads',
  keywords: [],
  rating: null,
};

const camry: Vehicle = { id: 'v1', makeId: 'toyota', modelId: 'camry', year: 2022, trim: 'GLE', engine: '2.5L I4', addedAt: 0 };

describe('guarantee badge logic', () => {
  it('only catalog-verified or by-specification fits are guaranteed', () => {
    expect(isGuaranteedFit('catalogMatch')).toBe(true);
    expect(isGuaranteedFit('bySpecification')).toBe(true);
    expect(isGuaranteedFit('sellerReported')).toBe(false);
    expect(isGuaranteedFit('noData')).toBe(false);
    expect(isGuaranteedFit('noVehicle')).toBe(false);
  });

  it('is covered for a catalog match on the selected vehicle', () => {
    const p = { ...base, fitment: [{ modelId: 'camry', yearFrom: 2018, yearTo: 2025, source: 'catalog' as const }] };
    expect(guaranteeState(p, camry)).toBe('covered');
    expect(guaranteeState(p, { ...camry, year: 2016 })).toBe('notCovered');
    expect(guaranteeState(p, undefined)).toBe('needsVehicle');
  });

  it('is never covered for seller-reported fitment', () => {
    const p = { ...base, fitment: [{ modelId: 'camry', yearFrom: 2018, yearTo: 2025, source: 'seller' as const }] };
    expect(guaranteeState(p, camry)).toBe('notCovered');
    expect(guaranteeState(p, undefined)).toBe('notCovered');
  });

  it('respects engine-specific fitment', () => {
    const p = { ...base, fitment: [{ modelId: 'camry', yearFrom: 2018, yearTo: 2025, engines: ['3.5L V6'], source: 'catalog' as const }] };
    expect(guaranteeState(p, camry)).toBe('notCovered');
    expect(guaranteeState(p, { ...camry, engine: '3.5L V6' })).toBe('covered');
  });

  it('by-specification parts are covered with or without a vehicle', () => {
    const p = { ...base, universal: { note: { ar: 'حسب المواصفة', en: 'By spec' } } };
    expect(guaranteeState(p, undefined)).toBe('covered');
    expect(guaranteeState(p, camry)).toBe('covered');
  });

  it('return shipping payer table matches the server policy', () => {
    expect(returnShippingPayer('wrongPart', true)).toBe('qitah');
    expect(returnShippingPayer('wrongPart', false, true)).toBe('seller');
    expect(returnShippingPayer('wrongPart', false)).toBe('customer');
    expect(returnShippingPayer('damaged', false)).toBe('seller');
    expect(returnShippingPayer('notAsDescribed', true)).toBe('seller');
    expect(returnShippingPayer('changedMind', true)).toBe('customer');
  });

  it('order view uses the server fit snapshot, not client logic, for guaranteed lines and returns', () => {
    const view = toOrderView({
      id: 'o',
      number: 'QT-1',
      status: 'DELIVERED',
      sandbox: true,
      createdAt: '2026-10-20T10:00:00Z',
      paidAt: '2026-10-20T10:01:00Z',
      paymentExpiresAt: '2026-10-20T10:30:00Z',
      paymentMethod: 'mada',
      address: null,
      vehicle: { label: 'نيسان باترول 2020', labelAr: 'نيسان باترول 2020', labelEn: 'Nissan Patrol 2020', vin: null },
      totals: { itemsHalalas: 29000, shippingHalalas: 1800, discountHalalas: 0, totalHalalas: 30800, vatHalalas: 4017, refundedHalalas: 0 },
      cancelReason: null,
      merchantOrders: [],
      items: [
        { id: 'i1', merchantOrderId: 'm', fulfillmentGroupId: 'g', offerId: 'o-101', productId: 'p1', nameAr: 'فلتر', nameEn: 'Filter', partNumber: 'X', condition: 'new', art: 'airFilter', quantity: 2, unitPriceHalalas: 14500, lineTotalHalalas: 29000, status: 'ACTIVE', fit: { status: 'catalogMatch', guaranteed: true } },
        { id: 'i2', merchantOrderId: 'm', fulfillmentGroupId: 'g', offerId: 'o-106', productId: 'p2', nameAr: 'مساعد', nameEn: 'Shock', partNumber: 'Y', condition: 'new', art: 'shock', quantity: 1, unitPriceHalalas: 31000, lineTotalHalalas: 31000, status: 'ACTIVE', fit: { status: 'sellerReported', guaranteed: false } },
      ],
      shipmentGroups: [],
      payment: null,
      refunds: [],
      returns: [
        {
          id: 'r1',
          number: 'RT-1',
          status: 'APPROVED',
          reason: 'wrongPart',
          refundHalalas: 0,
          guaranteed: true,
          autoApproved: true,
          photoCount: 0,
          returnShipping: { paidBy: 'PLATFORM', costHalalas: 1500, status: 'PENDING', trackingNumber: null },
          items: [{ orderItemId: 'i1', quantity: 2 }],
          createdAt: '2026-10-22T10:00:00Z',
        },
      ],
    });
    expect(view.items.map((i) => i.guaranteed)).toEqual([true, false]);
    expect(view.returns[0]).toMatchObject({ guaranteed: true, autoApproved: true, returnShipping: { payer: 'qitah', cost: 15 } });
    expect(view.vehicleName).toEqual({ ar: 'نيسان باترول 2020', en: 'Nissan Patrol 2020' });
  });
});
