import type { CategoryId } from '@/domain/types';

/**
 * Commission & settlement model (illustrative rates, server-authoritative in production).
 * Qitah never owns inventory: it collects payment, keeps commission, and settles the
 * remainder to the merchant after the return window.
 */
export const sampleCommissionRates: Record<CategoryId, number> = {
  brakes: 0.1,
  filters: 0.12,
  oils: 0.08,
  engine: 0.1,
  suspension: 0.1,
  electrical: 0.09,
  lighting: 0.12,
  cooling: 0.1,
  body: 0.08,
};

export type SettlementLine = {
  orderLineId: string;
  gross: number;
  commission: number;
  paymentFee: number;
  netToMerchant: number;
};

export function calculateSettlementLine(orderLineId: string, gross: number, categoryId: CategoryId, paymentFeeRate = 0.02): SettlementLine {
  const commission = round2(gross * sampleCommissionRates[categoryId]);
  const paymentFee = round2(gross * paymentFeeRate);
  return { orderLineId, gross, commission, paymentFee, netToMerchant: round2(gross - commission - paymentFee) };
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
