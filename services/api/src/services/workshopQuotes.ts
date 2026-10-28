import type { Prisma, WorkshopQuote } from '@prisma/client';

import { randomToken, sha256 } from '../auth/crypto.js';
import type { Ctx } from '../context.js';
import { prisma, withTx } from '../db.js';
import { AppError, badRequest, conflict, notFound } from '../lib/errors.js';
import { shortCode } from '../lib/ids.js';
import { publicOfferWhere } from './catalog.js';
import { checkout, planCheckout } from './checkout.js';
import { audit, emit, notify } from './events.js';
import { assertCanBuyFor, creditState, NET_TERMS } from './organizations.js';

/**
 * "عرض سعر للعميل" — a workshop prices a job for its own customer's car from Qitah catalog offers, adds its labour
 * and its own margin, and shares an unguessable link (WhatsApp-friendly, Arabic). The customer opens a public page
 * (no account, escaped, noindex; nothing beyond what the workshop typed) and approves or declines.
 *
 * Pricing shown to the customer is TRANSPARENT: each part at the Qitah price, then "أجرة اليد" (labour) and
 * "رسوم الورشة" (the workshop's margin, `markupHalalas`) as their own lines, then the total.
 *
 * Approval converts the quote into a workshop order bought at Qitah prices by the quote's creator for the org
 * (NET_TERMS when the credit line covers it, otherwise a card payment the workshop completes in the app).
 * The workshop collects from its customer however it likes; Qitah never charges the workshop's customer.
 */

export const QUOTE_TTL_MS = 72 * 3600_000;

export type QuoteVehicle = { plate?: string; vin?: string; model: string; year?: number };
export type QuoteLine = { offerId: string; productId: string; nameAr: string; nameEn: string; brand: string; partNumber: string; condition: string; quantity: number; unitPriceHalalas: number };

export type CreateQuoteInput = {
  addressId: string;
  vehicle: QuoteVehicle;
  lines: { offerId: string; quantity: number }[];
  laborHalalas: number;
  markupHalalas: number;
  note?: string;
  customerPhone?: string;
};

const quoteNumber = () => `WQ-${shortCode(7)}`;
const sar = (h: number) => (h / 100).toFixed(2);

export async function createWorkshopQuote(userId: string, orgId: string, input: CreateQuoteInput, baseUrl: string, now = new Date()) {
  const org = await assertCanBuyFor(prisma, userId, orgId);
  const address = await prisma.address.findFirst({ where: { id: input.addressId, userId, deletedAt: null } });
  if (!address) throw notFound('Address');
  const merged = new Map<string, number>();
  for (const l of input.lines) merged.set(l.offerId, Math.min(50, (merged.get(l.offerId) ?? 0) + l.quantity));
  const offers = await prisma.offer.findMany({ where: { id: { in: [...merged.keys()] }, ...publicOfferWhere, product: { status: 'ACTIVE' } }, include: { product: true } });
  const missing = [...merged.keys()].filter((id) => !offers.some((o) => o.id === id));
  if (missing.length) throw badRequest('OFFER_UNAVAILABLE', 'Some offers are no longer available', { offerIds: missing });
  const lines: QuoteLine[] = [...merged.entries()].map(([offerId, quantity]) => {
    const o = offers.find((x) => x.id === offerId)!;
    return { offerId, productId: o.productId, nameAr: o.product.nameAr, nameEn: o.product.nameEn, brand: o.product.brand, partNumber: o.product.partNumber, condition: o.condition, quantity, unitPriceHalalas: o.priceHalalas };
  });
  const partsHalalas = lines.reduce((s, l) => s + l.unitPriceHalalas * l.quantity, 0);
  const totalHalalas = partsHalalas + input.laborHalalas + input.markupHalalas;
  const vehicle: QuoteVehicle = {
    model: input.vehicle.model.trim(),
    ...(input.vehicle.plate?.trim() ? { plate: input.vehicle.plate.trim() } : {}),
    ...(input.vehicle.vin?.trim() ? { vin: input.vehicle.vin.trim().toUpperCase() } : {}),
    ...(input.vehicle.year ? { year: input.vehicle.year } : {}),
  };
  const token = randomToken(32);
  const quote = await withTx(async (tx) => {
    const q = await tx.workshopQuote.create({
      data: {
        number: quoteNumber(),
        orgId,
        createdByUserId: userId,
        addressId: address.id,
        vehicle: vehicle as unknown as Prisma.InputJsonValue,
        lines: lines as unknown as Prisma.InputJsonValue,
        partsHalalas,
        laborHalalas: input.laborHalalas,
        markupHalalas: input.markupHalalas,
        totalHalalas,
        note: input.note?.trim() || null,
        customerPhone: input.customerPhone ?? null,
        tokenHash: sha256(token),
        expiresAt: new Date(now.getTime() + QUOTE_TTL_MS),
      },
    });
    await audit(tx, { userId, type: 'customer' }, { action: 'workshop_quote.sent', entityType: 'organization', entityId: orgId, data: { quoteId: q.id, number: q.number, totalHalalas } });
    return q;
  });
  const url = `${baseUrl.replace(/\/+$/, '')}/q/${token}`;
  return { ...presentQuote(quote, now), url, share: shareText(org.displayName, quote, url) };
}

/** Arabic, WhatsApp-friendly share text (+ a wa.me link when the workshop typed the customer's phone). */
function shareText(orgName: string, q: WorkshopQuote, url: string) {
  const v = q.vehicle as unknown as QuoteVehicle;
  const car = [v.model, v.year, v.plate ? `(${v.plate})` : ''].filter(Boolean).join(' ');
  const text = `السلام عليكم، هذا عرض سعر من ${orgName} لسيارتك ${car}.\nالإجمالي: ${sar(q.totalHalalas)} ر.س (قطع ${sar(q.partsHalalas)} + أجرة ${sar(q.laborHalalas + q.markupHalalas)}).\nراجع التفاصيل واعتمد العرض من هنا:\n${url}`;
  const digits = q.customerPhone?.replace(/\D/g, '');
  return { text, whatsappUrl: `https://wa.me/${digits ?? ''}?text=${encodeURIComponent(text)}` };
}

export function presentQuote(q: WorkshopQuote, now = new Date()) {
  const expired = q.status === 'SENT' && q.expiresAt.getTime() <= now.getTime();
  return {
    id: q.id,
    number: q.number,
    orgId: q.orgId,
    status: expired ? ('EXPIRED' as const) : q.status,
    vehicle: q.vehicle as unknown as QuoteVehicle,
    lines: (q.lines as unknown as QuoteLine[]).map((l) => ({ ...l, lineTotalHalalas: l.unitPriceHalalas * l.quantity })),
    partsHalalas: q.partsHalalas,
    laborHalalas: q.laborHalalas,
    markupHalalas: q.markupHalalas,
    totalHalalas: q.totalHalalas,
    note: q.note,
    customerPhone: q.customerPhone,
    expiresAt: q.expiresAt.toISOString(),
    respondedAt: q.respondedAt?.toISOString() ?? null,
    orderId: q.orderId,
    convertError: q.convertError,
    createdAt: q.createdAt.toISOString(),
  };
}

export async function listWorkshopQuotes(orgId: string) {
  const rows = await prisma.workshopQuote.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 50 });
  return rows.map((q) => presentQuote(q));
}

export async function getWorkshopQuote(orgId: string, id: string) {
  const q = await prisma.workshopQuote.findFirst({ where: { id, orgId } });
  if (!q) throw notFound('Quote');
  return presentQuote(q);
}

// ── public (token) side

export async function findQuoteByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const q = await prisma.workshopQuote.findUnique({ where: { tokenHash: sha256(token) }, include: { org: { select: { displayName: true, city: true, district: true, contactPhone: true } } } });
  if (q && q.status === 'SENT' && q.expiresAt.getTime() <= Date.now()) {
    await prisma.workshopQuote.updateMany({ where: { id: q.id, status: 'SENT' }, data: { status: 'EXPIRED' } });
    return { ...q, status: 'EXPIRED' as const };
  }
  return q;
}

/** The customer's decision. Conditional on SENT + unexpired so two submissions cannot both win. */
export async function respondToQuote(q: WorkshopQuote, decision: 'approve' | 'decline', now = new Date()) {
  if (q.status !== 'SENT') throw new AppError(409, 'ALREADY_RESPONDED', 'تم الرد على هذا العرض مسبقاً');
  if (q.expiresAt.getTime() <= now.getTime()) throw new AppError(410, 'EXPIRED', 'انتهت صلاحية العرض');
  const status = decision === 'approve' ? 'APPROVED' : 'DECLINED';
  await withTx(async (tx) => {
    const r = await tx.workshopQuote.updateMany({ where: { id: q.id, status: 'SENT', expiresAt: { gt: now } }, data: { status, respondedAt: now } });
    if (!r.count) throw new AppError(409, 'ALREADY_RESPONDED', 'تم الرد على هذا العرض مسبقاً');
    await notify(tx, {
      audience: 'CUSTOMER',
      userId: q.createdByUserId,
      type: `workshop_quote.${status.toLowerCase()}`,
      title: status === 'APPROVED' ? `العميل اعتمد العرض ${q.number}` : `العميل رفض العرض ${q.number}`,
      body: status === 'APPROVED' ? 'جارٍ تحويل العرض إلى طلب للورشة' : 'يمكنك تعديل العرض وإرساله من جديد',
      data: { orgId: q.orgId, quoteId: q.id },
    });
    await audit(tx, { type: 'system' }, { action: `workshop_quote.${status.toLowerCase()}`, entityType: 'organization', entityId: q.orgId, data: { quoteId: q.id, number: q.number } });
    await emit(tx, { type: 'workshop_quote.responded', entityType: 'WorkshopQuote', entityId: q.id, customerId: q.createdByUserId, payload: { status } });
  });
  return status;
}

/**
 * Converts an APPROVED quote into a workshop order (idempotent: the order carries `workshopQuoteId`, unique, and the
 * checkout idempotency key is derived from the quote). Uses NET_TERMS when the org's credit covers it, else card.
 * On failure (stock gone, credit frozen, member removed…) the quote stays APPROVED with `convertError` and the
 * workshop can retry from the app.
 */
export async function convertWorkshopQuote(ctx: Ctx, quoteId: string) {
  const q = await prisma.workshopQuote.findUnique({ where: { id: quoteId } });
  if (!q) throw notFound('Quote');
  if (q.status === 'CONVERTED' && q.orderId) return { orderId: q.orderId, quote: presentQuote(q) };
  if (q.status !== 'APPROVED') throw conflict('QUOTE_NOT_APPROVED', `Quote is ${q.status}`);
  const buyer = q.createdByUserId;
  const v = q.vehicle as unknown as QuoteVehicle;
  try {
    await assertCanBuyFor(prisma, buyer, q.orgId);
    const lines = (q.lines as unknown as QuoteLine[]).map((l) => ({ offerId: l.offerId, quantity: l.quantity }));
    const plan = await planCheckout(ctx, buyer, { lines, addressId: q.addressId });
    if (plan.unavailable.length || !plan.options.length) throw conflict('QUOTE_ITEMS_UNAVAILABLE', 'Some parts are no longer available');
    const option = plan.options.find((o) => o.strategy === 'selected') ?? plan.options[0];
    const credit = await creditState(prisma, q.orgId);
    const base = { idempotencyKey: `wq:${q.id}`, buyerOrgId: q.orgId, workOrderRef: [q.number, v.plate].filter(Boolean).join(' · ').slice(0, 60), workshopQuoteId: q.id };
    let result;
    if (credit.netTermsEligible && credit.availableHalalas >= option.totalHalalas) {
      try {
        result = await checkout(ctx, buyer, { ...base, planId: option.planId, paymentMethod: NET_TERMS });
      } catch (e) {
        // Credit used up / frozen by a concurrent order: the transaction rolled back, so fall back to card.
        if (!(e instanceof AppError && ['CREDIT_LIMIT_EXCEEDED', 'CREDIT_FROZEN', 'NO_CREDIT_LINE'].includes(e.code))) throw e;
      }
    }
    result ??= await checkout(ctx, buyer, { ...base, planId: option.planId, paymentMethod: 'card' });
    const updated = await withTx(async (tx) => {
      const u = await tx.workshopQuote.update({ where: { id: q.id }, data: { status: 'CONVERTED', orderId: result.orderId, convertError: null } });
      await notify(tx, {
        audience: 'CUSTOMER',
        userId: buyer,
        type: 'workshop_quote.converted',
        title: `تم إنشاء الطلب ${result.number}`,
        body: result.status === 'PENDING_PAYMENT' ? `من العرض ${q.number} — أكمل الدفع لتأكيد الطلب` : `من العرض ${q.number} — على حساب الدفع الآجل`,
        data: { orgId: q.orgId, quoteId: q.id, orderId: result.orderId },
      });
      return u;
    });
    return { orderId: result.orderId, order: result, quote: presentQuote(updated) };
  } catch (e) {
    const message = e instanceof AppError ? `${e.code}: ${e.message}` : 'CONVERSION_FAILED';
    await prisma.workshopQuote.update({ where: { id: q.id }, data: { convertError: message.slice(0, 300) } });
    await notify(prisma, { audience: 'CUSTOMER', userId: buyer, type: 'workshop_quote.convert_failed', title: `تعذر تحويل العرض ${q.number} إلى طلب`, body: 'افتح العرض في التطبيق وأعد المحاولة', data: { orgId: q.orgId, quoteId: q.id } });
    throw e;
  }
}
