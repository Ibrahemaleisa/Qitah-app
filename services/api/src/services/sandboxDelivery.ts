import { prisma } from '../db.js';
import { signSandboxPayload, SANDBOX_SIGNATURE_HEADER } from '../providers/payment/sandbox.js';
import { randomToken } from '../auth/crypto.js';

export type Delivery = { url: string; body: string; headers: Record<string, string> };

export function paymentWebhook(secret: string, event: Record<string, unknown>): Delivery {
  const body = JSON.stringify({ id: `evt_${randomToken(10)}`, ...event });
  return { url: '/v1/webhooks/payments/sandbox', body, headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(secret, body) } };
}

export function carrierWebhook(secret: string, event: Record<string, unknown>): Delivery {
  const body = JSON.stringify({ id: `cev_${randomToken(10)}`, occurredAt: new Date().toISOString(), ...event });
  return { url: '/v1/webhooks/carriers/qitah-sandbox', body, headers: { 'content-type': 'application/json', [SANDBOX_SIGNATURE_HEADER]: signSandboxPayload(secret, body) } };
}

/** Sandbox PSP behaviour: every submitted refund settles successfully via a signed webhook. */
export async function pendingSandboxRefundWebhooks(secret: string): Promise<Delivery[]> {
  const refunds = await prisma.refund.findMany({ where: { status: 'PENDING', providerRefundId: { not: null }, payment: { provider: 'sandbox' } }, include: { payment: true }, take: 50 });
  return refunds.map((r) =>
    paymentWebhook(secret, { type: 'refund.succeeded', providerPaymentId: r.payment.providerPaymentId, providerRefundId: r.providerRefundId, amountHalalas: r.amountHalalas }),
  );
}
