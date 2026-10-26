// Generates realistic sandbox orders in varied states for exploring the ops portal:
//   node e2e/demo-orders.mjs        (API_BASE_URL defaults to http://127.0.0.1:4102)
// Creates: new (awaiting acceptance), accepted, ready (pending label), label created, pickup scheduled,
// in transit, a pickup failure, a delivery failure, a delivered order with a return request, and an
// approved return awaiting its RETURN shipment label.
import { api, createPaidOrder, login, merchantAdvance } from './lib/flows.mjs';

const admin = await login('ops.admin@qitah.test');
const ops = (path, body) => api(path, { token: admin, method: body === undefined ? 'GET' : 'POST', body });

async function shipmentsOf(orderId) {
  const t = await ops(`/v1/ops/orders/${orderId}`);
  return t.order.shipments.filter((s) => s.direction === 'OUTBOUND');
}
const window = (hoursFromNow, len = 2) => {
  const start = new Date(Date.now() + hoursFromNow * 3_600_000);
  return { windowStart: start.toISOString(), windowEnd: new Date(start.getTime() + len * 3_600_000).toISOString() };
};
async function advanceShipment(orderId, steps) {
  for (const s of await shipmentsOf(orderId)) {
    for (const step of steps) {
      if (step === 'label') await ops(`/v1/ops/shipments/${s.id}/label`, {});
      else if (step === 'pickup') await ops(`/v1/ops/shipments/${s.id}/pickup`, window(3));
      else await ops(`/v1/ops/shipments/${s.id}/sandbox-event`, { status: step });
    }
  }
}

const made = [];
async function scenario(label, lines, fn) {
  const o = await createPaidOrder({ lines });
  await fn(o);
  made.push(`${o.number}  ${label}`);
}

await scenario('new — awaiting merchant acceptance', [{ offerId: 'o-101', quantity: 1 }], async () => {});
await scenario('accepted by merchant', [{ offerId: 'o-108', quantity: 2 }], (o) => merchantAdvance(o.orderId, 'accept'));
await scenario('ready — shipment pending label (2 merchants)', [{ offerId: 'o-001', quantity: 1 }, { offerId: 'o-102', quantity: 1 }], (o) => merchantAdvance(o.orderId, 'ready'));
await scenario('label created', [{ offerId: 'o-001', quantity: 1 }], async (o) => {
  await merchantAdvance(o.orderId, 'ready');
  await advanceShipment(o.orderId, ['label']);
});
await scenario('pickup scheduled', [{ offerId: 'o-101', quantity: 1 }], async (o) => {
  await merchantAdvance(o.orderId, 'ready');
  await advanceShipment(o.orderId, ['label', 'pickup']);
});
await scenario('in transit', [{ offerId: 'o-107', quantity: 1 }], async (o) => {
  await merchantAdvance(o.orderId, 'ready');
  await advanceShipment(o.orderId, ['label', 'pickup', 'PICKED_UP', 'IN_TRANSIT']);
});
await scenario('pickup failed (exception)', [{ offerId: 'o-001', quantity: 1 }], async (o) => {
  await merchantAdvance(o.orderId, 'ready');
  await advanceShipment(o.orderId, ['label', 'pickup', 'PICKUP_FAILED']);
});
await scenario('delivery failed (exception)', [{ offerId: 'o-101', quantity: 1 }], async (o) => {
  await merchantAdvance(o.orderId, 'ready');
  await advanceShipment(o.orderId, ['label', 'pickup', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED']);
});
for (const approve of [false, true]) {
  await scenario(approve ? 'delivered → return approved (RETURN shipment pending label)' : 'delivered → return requested', [{ offerId: 'o-107', quantity: 1 }], async (o) => {
    await merchantAdvance(o.orderId, 'ready');
    await advanceShipment(o.orderId, ['label', 'pickup', 'PICKED_UP', 'DELIVERED']);
    const mine = await api(`/v1/orders/${o.orderId}`, { token: o.customerToken });
    const rc = await api(`/v1/orders/${o.orderId}/returns`, { token: o.customerToken, method: 'POST', body: { items: [{ orderItemId: mine.items[0].id, quantity: 1 }], reason: 'damaged', note: 'وصلت القطعة مكسورة' } });
    const cases = Array.isArray(rc) ? rc : (rc.returns ?? rc.items ?? [rc]);
    if (approve && cases[0]?.id) await ops(`/v1/ops/returns/${cases[0].id}/approve`, { note: 'موافقة — سيتم ترتيب الاستلام' });
  });
}

console.log('Created sandbox orders:\n' + made.map((m) => `  ${m}`).join('\n'));
