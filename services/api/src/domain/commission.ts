import type { CommissionChannel, Condition, PartOrigin } from '@prisma/client';

import { allocate, applyBps } from '../lib/money.js';

/**
 * Commission resolution (pure). A rule's NULL dimension matches anything. Among the active, in-window rules that
 * match a line, the MOST SPECIFIC wins. Specificity weights make any merchant-scoped rule beat any platform-wide one:
 *
 *   merchant 16 · category 8 · origin 4 · condition 2 · channel (B2C/B2B rather than ANY) 1
 *
 * Ties: higher `priority`, then the most recent `validFrom`, then id (deterministic).
 *
 * `Merchant.commissionBps` (when set) is the merchant's negotiated B2C rate. It behaves like a merchant-only rule
 * (specificity 16) for B2C lines: it overrides the platform tiers but loses to any explicit rule for that merchant
 * (an explicit merchant-only rule wins the tie). With nothing matching, the platform default applies.
 *
 * Resulting precedence:
 *   1. merchant rules naming more than the merchant (e.g. merchant + category)
 *   2. a merchant-only rule, then Merchant.commissionBps (B2C)
 *   3. platform rules, most specific first (category > origin > condition > channel)
 *   4. COMMISSION_DEFAULT_BPS
 */

export type Channel = 'B2C' | 'B2B';

export type CommissionRuleLike = {
  id: string;
  merchantId: string | null;
  categoryId: string | null;
  origin: PartOrigin | null;
  condition: Condition | null;
  channel: CommissionChannel;
  bps: number;
  priority: number;
  active: boolean;
  validFrom: Date | null;
  validTo: Date | null;
};

export type CommissionLine = { merchantId: string; categoryId: string; origin: PartOrigin; condition: Condition; channel: Channel };

export type CommissionResolution = { bps: number; source: 'rule' | 'merchant' | 'default'; ruleId: string | null };

const W = { merchant: 16, category: 8, origin: 4, condition: 2, channel: 1 } as const;

export function ruleMatches(rule: CommissionRuleLike, line: CommissionLine, at: Date): boolean {
  if (!rule.active) return false;
  if (rule.validFrom && rule.validFrom > at) return false;
  if (rule.validTo && rule.validTo <= at) return false;
  if (rule.merchantId !== null && rule.merchantId !== line.merchantId) return false;
  if (rule.categoryId !== null && rule.categoryId !== line.categoryId) return false;
  if (rule.origin !== null && rule.origin !== line.origin) return false;
  if (rule.condition !== null && rule.condition !== line.condition) return false;
  if (rule.channel !== 'ANY' && rule.channel !== line.channel) return false;
  return true;
}

export function ruleSpecificity(rule: Pick<CommissionRuleLike, 'merchantId' | 'categoryId' | 'origin' | 'condition' | 'channel'>): number {
  return (
    (rule.merchantId !== null ? W.merchant : 0) +
    (rule.categoryId !== null ? W.category : 0) +
    (rule.origin !== null ? W.origin : 0) +
    (rule.condition !== null ? W.condition : 0) +
    (rule.channel !== 'ANY' ? W.channel : 0)
  );
}

function compareRules(a: CommissionRuleLike, b: CommissionRuleLike): number {
  return (
    ruleSpecificity(b) - ruleSpecificity(a) ||
    b.priority - a.priority ||
    (b.validFrom?.getTime() ?? 0) - (a.validFrom?.getTime() ?? 0) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

export function resolveCommissionBps(input: {
  rules: CommissionRuleLike[];
  merchant: { id: string; commissionBps: number | null };
  line: Omit<CommissionLine, 'merchantId'>;
  at: Date;
  defaultBps: number;
}): CommissionResolution {
  const line: CommissionLine = { ...input.line, merchantId: input.merchant.id };
  const best = input.rules.filter((r) => ruleMatches(r, line, input.at)).sort(compareRules)[0];
  const merchantRate = input.merchant.commissionBps !== null && line.channel === 'B2C' ? input.merchant.commissionBps : null;
  if (best && (merchantRate === null || ruleSpecificity(best) >= W.merchant)) return { bps: best.bps, source: 'rule', ruleId: best.id };
  if (merchantRate !== null) return { bps: merchantRate, source: 'merchant', ruleId: null };
  return { bps: input.defaultBps, source: 'default', ruleId: null };
}

/** Commission on one order line at its resolved rate (half-up, integer halalas). */
export const lineCommission = (lineTotalHalalas: number, bps: number) => applyBps(lineTotalHalalas, bps);

/**
 * Splits a refund of `refundItems` halalas of item value over order lines with different commission rates.
 * The amount is spread by value (largest remainder), each share's commission reversed at ITS line's rate, and capped
 * at the commission still held on that line (`commissionHalalas` minus earlier reversals in `priorReversed`), so
 * rounding over several partial refunds can never reverse more than was charged.
 */
export function splitRefundByLine(
  lines: { orderItemId: string; valueHalalas: number; commissionBps: number; commissionHalalas: number }[],
  refundItems: number,
  priorReversed: Map<string, number> = new Map(),
): { commission: number; lines: { orderItemId: string; items: number; commission: number }[] } {
  if (!lines.length || refundItems <= 0) return { commission: 0, lines: [] };
  const shares = allocate(refundItems, lines.map((l) => l.valueHalalas));
  const out = lines.map((l, i) => {
    const remaining = Math.max(0, l.commissionHalalas - (priorReversed.get(l.orderItemId) ?? 0));
    return { orderItemId: l.orderItemId, items: shares[i], commission: Math.min(applyBps(shares[i], l.commissionBps), remaining) };
  });
  return { commission: out.reduce((s, l) => s + l.commission, 0), lines: out.filter((l) => l.items > 0 || l.commission > 0) };
}

/** Display rate of a merchant order whose lines carry different rates: Σ commission / Σ items, in bps (half-up). */
export function blendedBps(itemsHalalas: number, commissionHalalas: number): number {
  if (itemsHalalas <= 0) return 0;
  return Math.floor((commissionHalalas * 10000 + Math.floor(itemsHalalas / 2)) / itemsHalalas);
}

/**
 * Platform default tiers (evaluation committee, member 3): aftermarket B2C 10–12% (new 10%, used/refurbished 12%),
 * OEM B2C 7% (thin margins), accessories 13%, B2B 5%. Inserted by the *_merchant_economics migration and re-created
 * by the sandbox seed (which wipes every table) — keep both in sync.
 */
export const DEFAULT_COMMISSION_RULES = [
  { id: 'cr-default-aftermarket-new', name: 'تجاري جديد (B2C)', origin: 'AFTERMARKET', condition: 'NEW', categoryId: null, channel: 'B2C', bps: 1000 },
  { id: 'cr-default-aftermarket-used', name: 'تجاري مستعمل (B2C)', origin: 'AFTERMARKET', condition: 'USED', categoryId: null, channel: 'B2C', bps: 1200 },
  { id: 'cr-default-aftermarket-refurb', name: 'تجاري مُجدَّد (B2C)', origin: 'AFTERMARKET', condition: 'REFURBISHED', categoryId: null, channel: 'B2C', bps: 1200 },
  { id: 'cr-default-oem', name: 'أصلي OEM (B2C)', origin: 'OEM', condition: null, categoryId: null, channel: 'B2C', bps: 700 },
  { id: 'cr-default-accessories', name: 'إكسسوارات (B2C)', origin: null, condition: null, categoryId: 'accessories', channel: 'B2C', bps: 1300 },
  { id: 'cr-default-b2b', name: 'ورش ومنشآت (B2B)', origin: null, condition: null, categoryId: null, channel: 'B2B', bps: 500 },
] as const satisfies readonly { id: string; name: string; origin: PartOrigin | null; condition: Condition | null; categoryId: string | null; channel: CommissionChannel; bps: number }[];
