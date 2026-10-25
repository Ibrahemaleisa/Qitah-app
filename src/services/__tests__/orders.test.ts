import type { Address } from '@/domain/types';
import { canCancel, createOrder, orderStatus, returnableLineIds, shipmentTimeline } from '@/services/orders';

const address: Address = { id: 'a', kind: 'home', label: 'Home', city: 'riyadh', district: 'Al Olaya', street: 'King Fahd Rd', contactName: 'Test', phone: '+966500000000' };
const MIN = 60_000;

describe('order lifecycle (simulated)', () => {
  const order = createOrder({
    lines: [{ offerId: 'o-001', qty: 1 }, { offerId: 'o-025', qty: 1 }],
    address,
    shippingChoice: {},
    paymentMethodId: 'applePay',
    paymentReference: 'SIM-TEST',
  });

  it('creates one shipment per seller and VAT-inclusive totals', () => {
    expect(order.shipments).toHaveLength(2);
    expect(order.totals.items).toBe(389 + 149);
    expect(order.totals.total).toBe(order.totals.items + order.totals.shipping);
    expect(order.payment.simulated).toBe(true);
  });

  it('progresses through stages over time', () => {
    expect(orderStatus(order, order.createdAt)).toBe('processing');
    const far = order.createdAt + 24 * 60 * MIN;
    expect(orderStatus(order, far)).toBe('delivered');
    expect(shipmentTimeline(order, order.shipments[0], far).every((e) => e.reached)).toBe(true);
  });

  it('allows cancellation only before handover to the carrier', () => {
    expect(canCancel(order, order.createdAt)).toBe(true);
    const shippedAt = order.createdAt + Math.max(...order.shipments.map((s) => s.stageOffsetsMin.shipped)) * MIN;
    expect(canCancel(order, shippedAt)).toBe(false);
  });

  it('freezes the timeline once cancelled', () => {
    const cancelled = { ...order, cancellation: { requestedAt: order.createdAt + 1, reason: 'test' } };
    expect(orderStatus(cancelled, order.createdAt + 24 * 60 * MIN)).toBe('cancelled');
    expect(returnableLineIds(cancelled, order.createdAt + 24 * 60 * MIN)).toHaveLength(0);
  });

  it('opens returns after delivery and closes them after the window', () => {
    const delivered = order.createdAt + 24 * 60 * MIN;
    expect(returnableLineIds(order, delivered)).toHaveLength(2);
    expect(returnableLineIds(order, delivered + 8 * 24 * 60 * MIN)).toHaveLength(0);
  });
});
