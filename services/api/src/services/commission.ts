import type { CommissionChannel, Condition, PartOrigin, Prisma } from '@prisma/client';

import { prisma, type Db } from '../db.js';
import { resolveCommissionBps, type Channel, type CommissionResolution, type CommissionRuleLike } from '../domain/commission.js';
import { badRequest, notFound } from '../lib/errors.js';
import { audit, type Actor } from './events.js';

/**
 * The order's sales channel for commission purposes.
 * Orders placed on behalf of a workshop/fleet organisation (`Order.buyerOrgId`) are B2B; everything else is B2C.
 * This is the ONLY place that decides the channel.
 */
export function orderChannel(order: { id: string; buyerOrgId?: string | null }): Channel {
  return order.buyerOrgId ? 'B2B' : 'B2C';
}

/** Active rules that can apply to these merchants (their own rules + platform-wide ones). */
export async function loadCommissionRules(db: Db, merchantIds: string[]): Promise<CommissionRuleLike[]> {
  return db.commissionRule.findMany({ where: { active: true, OR: [{ merchantId: null }, { merchantId: { in: merchantIds } }] } });
}

export type ResolvedLine = CommissionResolution;

/** Resolves one line with the rules/merchant already loaded (the caller batches the queries). */
export function resolveLine(
  defaultBps: number,
  rules: CommissionRuleLike[],
  merchant: { id: string; commissionBps: number | null },
  line: { categoryId: string; origin: PartOrigin; condition: Condition },
  channel: Channel,
  at: Date,
): ResolvedLine {
  return resolveCommissionBps({ rules, merchant, line: { ...line, channel }, at, defaultBps });
}

const ORIGINS: PartOrigin[] = ['OEM', 'AFTERMARKET'];
const CONDITIONS: Condition[] = ['NEW', 'USED', 'REFURBISHED'];

/** A merchant's effective rates per category × origin × condition, per channel (merchant portal "عمولتك"). */
export async function effectiveRates(merchantId: string, defaultBps: number, at = new Date()) {
  const merchant = await prisma.merchant.findUnique({ where: { id: merchantId }, select: { id: true, commissionBps: true } });
  if (!merchant) throw notFound('Merchant');
  const [rules, categories] = await Promise.all([loadCommissionRules(prisma, [merchantId]), prisma.category.findMany({ orderBy: { sort: 'asc' } })]);
  const ruleNames = new Map((await prisma.commissionRule.findMany({ where: { id: { in: rules.map((r) => r.id) } }, select: { id: true, name: true, validTo: true } })).map((r) => [r.id, r]));
  const cell = (categoryId: string, origin: PartOrigin, condition: Condition, channel: Channel) => {
    const r = resolveLine(defaultBps, rules, merchant, { categoryId, origin, condition }, channel, at);
    const rule = r.ruleId ? ruleNames.get(r.ruleId) : undefined;
    return { bps: r.bps, source: r.source, ruleId: r.ruleId, ruleName: rule?.name ?? null, validTo: rule?.validTo ?? null };
  };
  return {
    merchantCommissionBps: merchant.commissionBps,
    defaultBps,
    channels: ['B2C', 'B2B'] as Channel[],
    categories: categories.map((c) => ({
      categoryId: c.id,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      rates: ORIGINS.flatMap((origin) =>
        CONDITIONS.map((condition) => ({ origin, condition, b2c: cell(c.id, origin, condition, 'B2C'), b2b: cell(c.id, origin, condition, 'B2B') })),
      ),
    })),
  };
}

// ───────────────────────────────────────────── rule management (ops)

export type RuleInput = {
  name: string;
  merchantId?: string | null;
  categoryId?: string | null;
  origin?: PartOrigin | null;
  condition?: Condition | null;
  channel?: CommissionChannel;
  bps: number;
  priority?: number;
  active?: boolean;
  validFrom?: Date | null;
  validTo?: Date | null;
  note?: string | null;
};

async function validateRule(input: Partial<RuleInput>) {
  if (input.merchantId && !(await prisma.merchant.findUnique({ where: { id: input.merchantId }, select: { id: true } }))) throw badRequest('INVALID_MERCHANT', 'Unknown merchant');
  if (input.categoryId && !(await prisma.category.findUnique({ where: { id: input.categoryId }, select: { id: true } }))) throw badRequest('INVALID_CATEGORY', 'Unknown category');
  if (input.validFrom && input.validTo && input.validTo <= input.validFrom) throw badRequest('INVALID_VALIDITY', 'validTo must be after validFrom');
}

export async function listRules() {
  const rules = await prisma.commissionRule.findMany({ orderBy: [{ active: 'desc' }, { merchantId: 'asc' }, { createdAt: 'asc' }] });
  const merchants = await prisma.merchant.findMany({ where: { id: { in: rules.flatMap((r) => (r.merchantId ? [r.merchantId] : [])) } }, select: { id: true, displayNameAr: true } });
  const names = new Map(merchants.map((m) => [m.id, m.displayNameAr]));
  return rules.map((r) => ({ ...r, merchantNameAr: r.merchantId ? (names.get(r.merchantId) ?? null) : null }));
}

export async function createRule(actor: Actor, input: RuleInput) {
  await validateRule(input);
  const rule = await prisma.commissionRule.create({ data: { ...input, createdById: actor.userId } as Prisma.CommissionRuleUncheckedCreateInput });
  await audit(prisma, actor, { action: 'commission_rule.created', entityType: 'commission_rule', entityId: rule.id, merchantId: rule.merchantId ?? undefined, data: input });
  return rule;
}

export async function updateRule(actor: Actor, id: string, input: Partial<RuleInput>) {
  const before = await prisma.commissionRule.findUnique({ where: { id } });
  if (!before) throw notFound('Commission rule');
  await validateRule({ ...before, ...input });
  const rule = await prisma.commissionRule.update({ where: { id }, data: input as Prisma.CommissionRuleUncheckedUpdateInput });
  await audit(prisma, actor, { action: 'commission_rule.updated', entityType: 'commission_rule', entityId: id, merchantId: rule.merchantId ?? undefined, data: { before: { bps: before.bps, active: before.active }, after: input } });
  return rule;
}

/** "Which rate would this line get?" — used by the ops rules screen. */
export async function previewRate(defaultBps: number, q: { merchantId: string; categoryId: string; origin: PartOrigin; condition: Condition; channel: Channel }) {
  const merchant = await prisma.merchant.findUnique({ where: { id: q.merchantId }, select: { id: true, commissionBps: true } });
  if (!merchant) throw notFound('Merchant');
  const rules = await loadCommissionRules(prisma, [q.merchantId]);
  return resolveLine(defaultBps, rules, merchant, q, q.channel, new Date());
}

/** Commission already reversed per order line by earlier PENDING/SUCCEEDED refunds of this order. */
export async function priorLineReversals(db: Db, orderId: string): Promise<Map<string, number>> {
  const refunds = await db.refund.findMany({ where: { orderId, status: { in: ['PENDING', 'SUCCEEDED'] } }, select: { allocation: true } });
  const out = new Map<string, number>();
  for (const r of refunds) {
    for (const a of r.allocation as { lines?: { orderItemId: string; commission: number }[] }[]) {
      for (const l of a.lines ?? []) out.set(l.orderItemId, (out.get(l.orderItemId) ?? 0) + l.commission);
    }
  }
  return out;
}
