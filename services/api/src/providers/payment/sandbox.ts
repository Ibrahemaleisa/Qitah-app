import { randomToken, hmacSha256, safeEqualHex } from '../../auth/crypto.js';
import type { PaymentProvider, PaymentWebhookEvent } from './types.js';

/**
 * QITAH SANDBOX PAYMENT PROVIDER — hosted test page + HMAC-signed webhooks. No real money moves.
 * Mirrors the integration shape of hosted-payment PSPs (redirect + signed server-to-server webhook)
 * so a real provider adapter can replace it without touching order logic.
 */
export const SANDBOX_SIGNATURE_HEADER = 'x-qitah-sandbox-signature';
const TOLERANCE_SECONDS = 300;

export function signSandboxPayload(secret: string, rawBody: string, timestamp = Math.floor(Date.now() / 1000)): string {
  return `t=${timestamp},v1=${hmacSha256(secret, `${timestamp}.${rawBody}`)}`;
}

export class SandboxPaymentProvider implements PaymentProvider {
  readonly code = 'sandbox';
  readonly sandbox = true;

  constructor(
    private baseUrl: string,
    private webhookSecret: string,
  ) {}

  async createPayment(input: { paymentId: string }) {
    const providerPaymentId = `sbx_pay_${randomToken(12)}`;
    return { providerPaymentId, redirectUrl: `${this.baseUrl}/sandbox/pay/${providerPaymentId}` };
  }

  async refund(_input: { providerPaymentId: string; amountHalalas: number; idempotencyKey: string }) {
    return { providerRefundId: `sbx_ref_${randomToken(12)}` };
  }

  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): PaymentWebhookEvent {
    const header = headers[SANDBOX_SIGNATURE_HEADER];
    if (typeof header !== 'string') throw new Error('Missing signature');
    const parts = Object.fromEntries(header.split(',').map((p) => p.split('=') as [string, string]));
    const t = Number(parts.t);
    if (!Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) throw new Error('Stale signature');
    if (!parts.v1 || !safeEqualHex(parts.v1, hmacSha256(this.webhookSecret, `${t}.${rawBody}`))) throw new Error('Bad signature');
    const event = JSON.parse(rawBody) as PaymentWebhookEvent;
    if (!event.id || !event.type || !event.providerPaymentId || !Number.isSafeInteger(event.amountHalalas)) {
      throw new Error('Malformed event');
    }
    return event;
  }
}
