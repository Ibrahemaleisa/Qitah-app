import type { ApiOrder } from '@/api/types';
import { mapOrderStatus, mapShipmentStage, shipmentException, toOrderView } from '@/services/remote/orderView';

describe('server state → shipment stage', () => {
  const stage = (merchantOrderStatus: string, shipmentStatus?: string, paid = true) => mapShipmentStage({ paid, merchantOrderStatus, shipmentStatus });

  it('shows nothing before payment, and "placed" once paid', () => {
    expect(stage('PENDING_PAYMENT', undefined, false)).toBeNull();
    expect(stage('NEW')).toBe('placed');
  });

  it('maps merchant progress', () => {
    expect(stage('ACCEPTED')).toBe('confirmed');
    expect(stage('PACKING')).toBe('packed');
    expect(stage('READY_FOR_PICKUP')).toBe('packed');
    expect(stage('HANDED_OVER')).toBe('shipped');
  });

  it('maps carrier progress', () => {
    expect(stage('READY_FOR_PICKUP', 'PENDING')).toBe('packed');
    expect(stage('READY_FOR_PICKUP', 'LABEL_CREATED')).toBe('packed');
    expect(stage('READY_FOR_PICKUP', 'PICKED_UP')).toBe('shipped');
    expect(stage('HANDED_OVER', 'IN_TRANSIT')).toBe('shipped');
    expect(stage('HANDED_OVER', 'OUT_FOR_DELIVERY')).toBe('outForDelivery');
    expect(stage('DELIVERED', 'DELIVERED')).toBe('delivered');
  });

  it('keeps the last real stage on exceptions and flags them', () => {
    expect(stage('READY_FOR_PICKUP', 'PICKUP_FAILED')).toBe('packed');
    expect(shipmentException('PICKUP_FAILED')).toBe('PICKUP_FAILED');
    expect(stage('HANDED_OVER', 'DELIVERY_FAILED')).toBe('outForDelivery');
    expect(shipmentException('DELIVERY_FAILED')).toBe('DELIVERY_FAILED');
    expect(shipmentException('IN_TRANSIT')).toBeUndefined();
  });
});

describe('server order status → app status', () => {
  it('distinguishes awaiting, failed and expired payment', () => {
    expect(mapOrderStatus({ status: 'PENDING_PAYMENT', payment: { id: 'p', status: 'INITIATED', method: 'mada', sandbox: true, redirectUrl: 'x' } })).toBe('pendingPayment');
    expect(mapOrderStatus({ status: 'PENDING_PAYMENT', payment: { id: 'p', status: 'FAILED', method: 'mada', sandbox: true, redirectUrl: null } })).toBe('paymentFailed');
    expect(mapOrderStatus({ status: 'EXPIRED', payment: null })).toBe('expired');
  });

  it('maps fulfilment states', () => {
    expect(mapOrderStatus({ status: 'PAID', payment: null })).toBe('processing');
    expect(mapOrderStatus({ status: 'IN_FULFILLMENT', payment: null }, ['shipped', 'packed'])).toBe('inTransit');
    expect(mapOrderStatus({ status: 'PARTIALLY_DELIVERED', payment: null })).toBe('partiallyDelivered');
    expect(mapOrderStatus({ status: 'DELIVERED', payment: null })).toBe('delivered');
    expect(mapOrderStatus({ status: 'CANCELLED', payment: null })).toBe('cancelled');
  });
});

const NOW = Date.parse('2026-10-26T12:00:00Z');

function order(patch: Partial<ApiOrder> = {}): ApiOrder {
  return {
    id: 'ord1',
    number: 'QT-261026-ABCDE',
    status: 'IN_FULFILLMENT',
    sandbox: true,
    createdAt: '2026-10-26T10:00:00Z',
    paidAt: '2026-10-26T10:01:00Z',
    paymentExpiresAt: '2026-10-26T10:30:00Z',
    paymentMethod: 'mada',
    address: { kind: 'HOME', label: 'Home', city: 'riyadh', district: 'Olaya', street: 'King Fahd', contactName: 'Sara', phone: '+966500000001', workshopName: null },
    vehicle: { label: 'Toyota Camry 2022' },
    totals: { itemsHalalas: 67000, shippingHalalas: 7450, discountHalalas: 0, totalHalalas: 74450, vatHalalas: 9711, refundedHalalas: 0 },
    cancelReason: null,
    merchantOrders: [
      { id: 'mo-a', number: 'QT-261026-ABCDE-A', status: 'DELIVERED', merchant: { id: 's-eastern', nameAr: 'قطع الشرقية', nameEn: 'Eastern Parts Co.', city: 'dammam' }, itemsHalalas: 37200, shippingHalalas: 3200, deliveredAt: '2026-10-26T11:00:00Z' },
      { id: 'mo-b', number: 'QT-261026-ABCDE-B', status: 'READY_FOR_PICKUP', merchant: { id: 's-elite-oils', nameAr: 'النخبة', nameEn: 'Elite', city: 'khobar' }, itemsHalalas: 29800, shippingHalalas: 4250, deliveredAt: null },
    ],
    items: [
      { id: 'i1', merchantOrderId: 'mo-a', fulfillmentGroupId: 'g-a', offerId: 'o-003', productId: 'p-camry-pads-oem', nameAr: 'فحمات', nameEn: 'Pads', partNumber: '04465', condition: 'new', art: 'pads', quantity: 2, unitPriceHalalas: 18600, lineTotalHalalas: 37200, status: 'ACTIVE' },
      { id: 'i2', merchantOrderId: 'mo-b', fulfillmentGroupId: 'g-b', offerId: 'o-025', productId: 'p-oil-5w30', nameAr: 'زيت', nameEn: 'Oil', partNumber: 'MRD', condition: 'new', art: 'oil', quantity: 2, unitPriceHalalas: 14900, lineTotalHalalas: 29800, status: 'ACTIVE' },
    ],
    shipmentGroups: [
      {
        id: 'g-a',
        merchantOrderId: 'mo-a',
        serviceCode: 'standard',
        carrierCode: 'qitah-sandbox',
        shippingHalalas: 3200,
        etaDaysMin: 5,
        etaDaysMax: 7,
        originCity: 'dammam',
        shipment: {
          id: 'sh-a',
          status: 'DELIVERED',
          trackingNumber: 'SBX123',
          sandbox: true,
          events: [
            { status: 'LABEL_CREATED', description: 'label', location: null, occurredAt: '2026-10-26T10:10:00Z' },
            { status: 'PICKED_UP', description: 'picked', location: null, occurredAt: '2026-10-26T10:20:00Z' },
            { status: 'DELIVERED', description: 'done', location: 'Riyadh', occurredAt: '2026-10-26T11:00:00Z' },
          ],
        },
      },
      { id: 'g-b', merchantOrderId: 'mo-b', serviceCode: 'express', carrierCode: 'qitah-sandbox', shippingHalalas: 4250, etaDaysMin: 1, etaDaysMax: 2, originCity: null, shipment: { id: 'sh-b', status: 'PICKUP_FAILED', trackingNumber: 'SBX456', sandbox: true, events: [] } },
    ],
    payment: { id: 'p1', status: 'CAPTURED', method: 'mada', sandbox: true, redirectUrl: null },
    refunds: [{ id: 'r1', amountHalalas: 18600, status: 'PENDING', reason: 'RETURN', createdAt: '2026-10-26T11:30:00Z' }],
    returns: [{ id: 'rc1', number: 'RT-1', status: 'REQUESTED', reason: 'damaged', refundHalalas: 0, items: [{ orderItemId: 'i1', quantity: 1 }], createdAt: '2026-10-26T11:20:00Z' }],
    ...patch,
  };
}

describe('toOrderView', () => {
  it('converts every amount from halalas once, without client-side totals', () => {
    const v = toOrderView(order(), NOW);
    expect(v.totals).toEqual({ items: 670, shipping: 74.5, total: 744.5, vat: 97.11, refunded: 0 });
    expect(v.items[0]).toMatchObject({ unitPrice: 186, lineTotal: 372, qty: 2 });
    expect(v.shipments.map((s) => s.shippingFee)).toEqual([32, 42.5]);
    expect(v.refunds[0].amount).toBe(186);
  });

  it('builds per-shipment stages, timestamps, exceptions and sandbox tracking', () => {
    const v = toOrderView(order(), NOW);
    const [a, b] = v.shipments;
    expect(a.stage).toBe('delivered');
    expect(a.stageIndex).toBe(5);
    expect(a.timeline.every((e) => e.reached)).toBe(true);
    expect(a.timeline.find((e) => e.stage === 'shipped')?.at).toBe(Date.parse('2026-10-26T10:20:00Z'));
    expect(a.timeline.find((e) => e.stage === 'confirmed')?.at).toBeNull();
    expect(a.sandboxTracking).toBe(true);
    expect(a.sellerName.en).toBe('Eastern Parts Co.');
    expect(b.stage).toBe('packed');
    expect(b.exception).toBe('PICKUP_FAILED');
    expect(b.timeline.find((e) => e.stage === 'shipped')?.reached).toBe(false);
    expect(v.status).toBe('partiallyDelivered');
  });

  it('only lets delivered items within the window be returned, minus open returns', () => {
    const v = toOrderView(order(), NOW);
    expect(v.returnable).toEqual([{ itemId: 'i1', maxQty: 1 }]);
    const late = toOrderView(order(), NOW + 8 * 86_400_000);
    expect(late.returnable).toEqual([]);
    const rejected = toOrderView(order({ returns: [{ ...order().returns[0], status: 'REJECTED' }] }), NOW);
    expect(rejected.returnable).toEqual([{ itemId: 'i1', maxQty: 2 }]);
  });

  it('allows cancellation only before anything ships', () => {
    expect(toOrderView(order(), NOW).canCancel).toBe(false);
    const early = order({ status: 'PAID', merchantOrders: order().merchantOrders.map((m) => ({ ...m, status: 'ACCEPTED', deliveredAt: null })) });
    expect(toOrderView(early, NOW).canCancel).toBe(true);
    expect(toOrderView(order({ status: 'PENDING_PAYMENT', paidAt: null }), NOW).canCancel).toBe(true);
  });

  it('shows no stage at all while payment is pending', () => {
    const v = toOrderView(order({ status: 'PENDING_PAYMENT', paidAt: null, payment: { id: 'p', status: 'INITIATED', method: 'mada', sandbox: true, redirectUrl: 'http://x' } }), NOW);
    expect(v.status).toBe('pendingPayment');
    expect(v.shipments.every((s) => s.stage === null && s.timeline.every((e) => !e.reached))).toBe(true);
  });

  it('survives partial data', () => {
    const v = toOrderView({ ...order(), items: [], shipmentGroups: [], returns: [], refunds: [], address: null, merchantOrders: [] } as ApiOrder, NOW);
    expect(v.shipments).toEqual([]);
    expect(v.address).toBeNull();
    expect(v.canCancel).toBe(false);
  });
});
