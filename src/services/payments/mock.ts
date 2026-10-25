import type { PaymentMethodId } from '@/domain/types';

import type { Eligibility, PaymentKind, PaymentMethodMeta, PaymentProvider, PaymentRequest, PaymentResult, RefundResult } from './types';

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * SIMULATED payment provider. It never contacts a payment network, never collects card data,
 * and every result is flagged `simulated: true`.
 */
class SimulatedPaymentProvider implements PaymentProvider {
  constructor(
    readonly methodId: PaymentMethodId,
    readonly kind: PaymentKind,
    private readonly limits?: { min: number; max: number },
  ) {}

  checkEligibility(amount: number): Eligibility {
    if (!this.limits) return { eligible: true };
    if (amount < this.limits.min) {
      return { eligible: false, reason: { ar: `متاح للطلبات من ${this.limits.min} ر.س`, en: `Available from SAR ${this.limits.min}` } };
    }
    if (amount > this.limits.max) {
      return { eligible: false, reason: { ar: `متاح للطلبات حتى ${this.limits.max} ر.س`, en: `Available up to SAR ${this.limits.max}` } };
    }
    return { eligible: true };
  }

  async authorize(request: PaymentRequest): Promise<PaymentResult> {
    await wait(1400);
    return { status: 'authorized', reference: `SIM-${request.orderReference}`, simulated: true };
  }

  async refund(reference: string): Promise<RefundResult> {
    await wait(600);
    return { status: 'pending', reference: `SIM-RF-${reference}`, simulated: true };
  }
}

/** BNPL limits below are illustrative sample rules, not provider terms. */
export const paymentProviders: Record<PaymentMethodId, PaymentProvider> = {
  applePay: new SimulatedPaymentProvider('applePay', 'wallet'),
  mada: new SimulatedPaymentProvider('mada', 'card'),
  card: new SimulatedPaymentProvider('card', 'card'),
  stcPay: new SimulatedPaymentProvider('stcPay', 'wallet'),
  tabby: new SimulatedPaymentProvider('tabby', 'bnpl', { min: 100, max: 5000 }),
  tamara: new SimulatedPaymentProvider('tamara', 'bnpl', { min: 100, max: 5000 }),
};

export const paymentMethods: PaymentMethodMeta[] = [
  { id: 'applePay', kind: 'wallet', name: { ar: 'Apple Pay', en: 'Apple Pay' }, description: { ar: 'ادفع بلمسة عبر محفظة آيفون', en: 'Pay with your iPhone wallet' } },
  { id: 'mada', kind: 'card', name: { ar: 'بطاقة مدى', en: 'mada card' }, description: { ar: 'بطاقات الخصم المحلية', en: 'Saudi debit cards' } },
  { id: 'card', kind: 'card', name: { ar: 'بطاقة ائتمانية', en: 'Credit card' }, description: { ar: 'فيزا وماستركارد', en: 'Visa & Mastercard' } },
  { id: 'stcPay', kind: 'wallet', name: { ar: 'STC Pay', en: 'STC Pay' }, description: { ar: 'المحفظة الرقمية', en: 'Digital wallet' } },
  { id: 'tabby', kind: 'bnpl', name: { ar: 'تابي', en: 'Tabby' }, description: { ar: 'قسّمها على 4 دفعات بدون فوائد', en: 'Split into 4 interest-free payments' } },
  { id: 'tamara', kind: 'bnpl', name: { ar: 'تمارا', en: 'Tamara' }, description: { ar: 'ادفع لاحقاً أو على دفعات', en: 'Pay later or in instalments' } },
];
