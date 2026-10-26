export type PaymentWebhookEvent = {
  id: string;
  type: 'payment.captured' | 'payment.failed' | 'refund.succeeded' | 'refund.failed';
  providerPaymentId: string;
  providerRefundId?: string;
  amountHalalas: number;
  failureReason?: string;
};

export interface PaymentProvider {
  readonly code: string;
  readonly sandbox: boolean;
  createPayment(input: {
    paymentId: string;
    amountHalalas: number;
    method: string;
    description: string;
    returnUrl: string;
  }): Promise<{ providerPaymentId: string; redirectUrl: string }>;
  refund(input: { providerPaymentId: string; amountHalalas: number; idempotencyKey: string }): Promise<{ providerRefundId: string }>;
  /** Throws if the signature is invalid or stale. Never trust unverified payloads. */
  verifyWebhook(rawBody: string, headers: Record<string, string | string[] | undefined>): PaymentWebhookEvent;
}
