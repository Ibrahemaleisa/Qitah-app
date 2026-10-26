// Scripted customer + merchant flows against the real Qitah API (sandbox providers).
// Used by the smoke test and by `npm run demo:orders` to generate realistic orders.
import { randomUUID } from 'node:crypto';

export const API = process.env.API_BASE_URL ?? 'http://127.0.0.1:4102';
export const PASSWORD = process.env.SEED_PASSWORD ?? 'Qitah-Sandbox-2026!';

export async function api(path, { token, method = 'GET', body, form } = {}) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    headers['content-type'] = 'application/x-www-form-urlencoded';
    payload = new URLSearchParams(form).toString();
  } else if (body !== undefined) {
    headers['content-type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const res = await fetch(url, { method, headers, body: payload, redirect: 'manual' });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : undefined;
  } catch {
    json = text;
  }
  if (res.status >= 400) throw new Error(`${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
  return json;
}

export async function login(email, password = PASSWORD) {
  const r = await api('/v1/auth/login', { method: 'POST', body: { email, password } });
  return r.accessToken;
}

/** Random Saudi mobile (+9665XXXXXXXX). */
export const randomPhone = () => `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

export async function customerSession(phone = randomPhone(), name = 'عميل اختبار العمليات') {
  const otp = await api('/v1/auth/otp/request', { method: 'POST', body: { phone } });
  const v = await api('/v1/auth/otp/verify', { method: 'POST', body: { phone, code: otp.sandboxCode, name } });
  return { token: v.accessToken, phone, userId: v.user.id };
}

/** Customer places and pays (sandbox) an order. Returns { orderId, number, phone }. */
export async function createPaidOrder({ lines = [{ offerId: 'o-001', quantity: 1 }], city = 'riyadh', pay = true } = {}) {
  const c = await customerSession();
  const address = await api('/v1/me/addresses', {
    token: c.token,
    method: 'POST',
    body: { kind: 'home', label: 'المنزل', city, district: 'الملقا', street: 'شارع أنس بن مالك', contactName: 'عميل اختبار', phone: c.phone },
  });
  const plan = await api('/v1/checkout/plan', { token: c.token, method: 'POST', body: { addressId: address.id, lines } });
  const planId = plan.planId ?? plan.options?.[0]?.planId;
  const order = await api('/v1/checkout', { token: c.token, method: 'POST', body: { planId, idempotencyKey: randomUUID(), paymentMethod: 'mada' } });
  if (pay) await api(order.payment.redirectUrl, { method: 'POST', form: { outcome: 'success' } });
  return { orderId: order.orderId, number: order.number, phone: c.phone, customerToken: c.token };
}

/** Finds the merchant suborders of an order (via the merchant owners' own API). */
export async function merchantOrdersOf(orderId) {
  const admin = await login('ops.admin@qitah.test');
  const trace = await api(`/v1/ops/orders/${orderId}`, { token: admin });
  return trace.order.merchantOrders.map((m) => ({ id: m.id, number: m.number, merchantId: m.merchantId, status: m.status }));
}

/** The merchant owner accepts → packs → marks ready, through the merchant API. */
export async function merchantAdvance(orderId, until = 'ready') {
  const steps = ['accept', 'pack', 'ready'];
  const mos = await merchantOrdersOf(orderId);
  for (const mo of mos) {
    const ownerEmail = `owner@${mo.merchantId.replace(/^s-/, '')}.qitah.test`;
    const token = await login(ownerEmail);
    for (const step of steps.slice(0, steps.indexOf(until) + 1)) {
      await api(`/v1/merchants/${mo.merchantId}/orders/${mo.id}/${step}`, { token, method: 'POST', body: {} });
    }
  }
  return mos;
}
