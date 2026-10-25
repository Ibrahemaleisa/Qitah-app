import type { L10n, PaymentMethodId } from '@/domain/types';

/**
 * Payment provider contract. Real adapters (Apple Pay via a Saudi PSP, mada/cards through a
 * hosted tokenisation SDK, STC Pay, BNPL providers) implement this interface on the server
 * side; the app never handles raw card data.
 */

export type PaymentKind = 'wallet' | 'card' | 'bnpl';

export type PaymentRequest = {
  orderReference: string;
  amount: number;
  currency: 'SAR';
  customerId?: string;
};

export type PaymentResult =
  | { status: 'authorized'; reference: string; simulated: boolean }
  | { status: 'declined'; reason: string; simulated: boolean }
  | { status: 'requires_action'; redirectUrl: string; simulated: boolean };

export type RefundResult = { status: 'refunded' | 'pending' | 'failed'; reference: string; simulated: boolean };

export type Eligibility = { eligible: true } | { eligible: false; reason: L10n };

export interface PaymentProvider {
  readonly methodId: PaymentMethodId;
  readonly kind: PaymentKind;
  checkEligibility(amount: number): Eligibility;
  authorize(request: PaymentRequest): Promise<PaymentResult>;
  refund(reference: string, amount: number): Promise<RefundResult>;
}

export type PaymentMethodMeta = {
  id: PaymentMethodId;
  kind: PaymentKind;
  name: L10n;
  description: L10n;
};
