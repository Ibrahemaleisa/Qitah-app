import type { LedgerAccount, Prisma } from '@prisma/client';

import type { Tx } from '../db.js';

export type LedgerLine = { account: LedgerAccount; amountHalalas: number; merchantId?: string; merchantOrderId?: string };

/**
 * Posts a balanced, idempotent journal entry. Returns false if this (type, refId) was already posted.
 * Sign convention: positive = debit, negative = credit. MERCHANT_PAYABLE credit balance = owed to merchant.
 */
export async function post(tx: Tx, input: { type: string; refType: string; refId: string; orderId?: string; lines: LedgerLine[] }): Promise<boolean> {
  const lines = input.lines.filter((l) => l.amountHalalas !== 0);
  const total = lines.reduce((s, l) => s + l.amountHalalas, 0);
  if (total !== 0 || lines.some((l) => !Number.isSafeInteger(l.amountHalalas))) {
    throw new Error(`Unbalanced ledger posting ${input.type}/${input.refId}: ${total}`);
  }
  const existing = await tx.ledgerPosting.findUnique({ where: { type_refId: { type: input.type, refId: input.refId } } });
  if (existing) return false;
  const posting = await tx.ledgerPosting.create({ data: { type: input.type, refId: input.refId } });
  const data: Prisma.LedgerEntryCreateManyInput[] = lines.map((l) => ({
    postingId: posting.id,
    postingType: input.type,
    account: l.account,
    amountHalalas: l.amountHalalas,
    orderId: input.orderId,
    merchantId: l.merchantId,
    merchantOrderId: l.merchantOrderId,
    refType: input.refType,
    refId: input.refId,
  }));
  await tx.ledgerEntry.createMany({ data });
  return true;
}
