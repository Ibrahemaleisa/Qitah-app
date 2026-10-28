import type { MechanicReview, Prisma } from '@prisma/client';

import { randomToken, sha256 } from '../auth/crypto.js';
import { prisma, withTx } from '../db.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { publicOfferWhere } from './catalog.js';
import { emit, notify } from './events.js';

/**
 * "أرسل لميكانيكي" — the customer shares a parts list through an unguessable link; the mechanic
 * reviews it on a public page (no account) and approves each line or suggests an alternative.
 *
 * - The link token (256 bits) is shown once; only its SHA-256 is stored.
 * - The page shows the vehicle and parts only: never the customer's name, phone or address.
 * - The workshop name/phone the mechanic types in are kept as lead data for a future workshop phase.
 */

export const REVIEW_TTL_MS = 72 * 3600_000;

export type FitLabel = 'catalog' | 'seller' | 'universal' | 'unverified' | 'no_vehicle';

export type ReviewAlternative = { offerId: string; condition: string; warrantyMonths: number; sellerAr: string; sellerEn: string; city: string };
export type ReviewLine = {
  offerId: string;
  productId: string;
  quantity: number;
  nameAr: string;
  nameEn: string;
  brand: string;
  partNumber: string;
  oemReferences: string[];
  origin: 'oem' | 'aftermarket';
  condition: string;
  warrantyMonths: number;
  sellerAr: string;
  sellerEn: string;
  fit: FitLabel;
  alternatives: ReviewAlternative[];
};
export type ReviewVehicle = { modelId: string; makeAr: string; makeEn: string; modelAr: string; modelEn: string; year: number; engine: string; vin: string | null };
export type ReviewSnapshot = { vehicle: ReviewVehicle | null; lines: ReviewLine[] };
export type ReviewDecision = { offerId: string; decision: 'APPROVED' | 'ALTERNATIVE'; text?: string; partNumber?: string; alternativeOfferId?: string };

const offerInclude = {
  inventory: true,
  location: true,
  merchant: true,
  product: { include: { identifiers: true, fitments: true } },
} satisfies Prisma.OfferInclude;
type OfferRow = Prisma.OfferGetPayload<{ include: typeof offerInclude }>;

function fitFor(o: OfferRow, v: { modelId: string; year: number; engine: string } | null): FitLabel {
  const p = o.product;
  const applies = p.fitments.filter((f) => v && f.modelId === v.modelId && v.year >= f.yearFrom && v.year <= f.yearTo && (f.engines.length === 0 || f.engines.includes(v.engine)));
  if (applies.some((f) => f.source === 'CATALOG')) return 'catalog';
  if (applies.some((f) => f.source === 'SELLER')) return 'seller';
  if (p.universalNoteAr) return 'universal';
  return v ? 'unverified' : 'no_vehicle';
}

export async function createMechanicReview(
  userId: string,
  input: { lines: { offerId: string; quantity: number }[]; vehicleId?: string; note?: string },
  baseUrl: string,
  now = new Date(),
) {
  const merged = new Map<string, number>();
  for (const l of input.lines) merged.set(l.offerId, Math.min(20, (merged.get(l.offerId) ?? 0) + l.quantity));

  let vehicle: ReviewVehicle | null = null;
  let vehicleFit: { modelId: string; year: number; engine: string } | null = null;
  if (input.vehicleId) {
    const v = await prisma.garageVehicle.findFirst({ where: { id: input.vehicleId, userId, deletedAt: null }, include: { model: { include: { make: true } } } });
    if (!v) throw notFound('Vehicle');
    vehicle = { modelId: v.modelId, makeAr: v.model.make.nameAr, makeEn: v.model.make.nameEn, modelAr: v.model.nameAr, modelEn: v.model.nameEn, year: v.year, engine: v.engine, vin: v.vin };
    vehicleFit = v;
  }

  const offers = await prisma.offer.findMany({ where: { id: { in: [...merged.keys()] }, ...publicOfferWhere, product: { status: 'ACTIVE' } }, include: offerInclude });
  const missing = [...merged.keys()].filter((id) => !offers.some((o) => o.id === id));
  if (missing.length) throw badRequest('OFFER_UNAVAILABLE', 'Some offers are no longer available', { offerIds: missing });

  const siblings = await prisma.offer.findMany({
    where: { productId: { in: [...new Set(offers.map((o) => o.productId))] }, ...publicOfferWhere, inventory: { onHand: { gt: 0 } } },
    include: { merchant: true, location: true, inventory: true },
    orderBy: { priceHalalas: 'asc' },
  });

  const lines: ReviewLine[] = [...merged.entries()].map(([offerId, quantity]) => {
    const o = offers.find((x) => x.id === offerId)!;
    return {
      offerId,
      productId: o.productId,
      quantity,
      nameAr: o.product.nameAr,
      nameEn: o.product.nameEn,
      brand: o.product.brand,
      partNumber: o.product.partNumber,
      oemReferences: o.product.identifiers.filter((i) => i.type === 'OEM' && i.value !== o.product.partNumber).map((i) => i.value),
      origin: o.product.origin === 'OEM' ? 'oem' : 'aftermarket',
      condition: o.condition,
      warrantyMonths: o.warrantyMonths,
      sellerAr: o.merchant.displayNameAr,
      sellerEn: o.merchant.displayNameEn,
      fit: fitFor(o, vehicleFit),
      alternatives: siblings
        .filter((s) => s.productId === o.productId && s.id !== o.id && (s.inventory ? s.inventory.onHand - s.inventory.reserved > 0 : false))
        .slice(0, 5)
        .map((s) => ({ offerId: s.id, condition: s.condition, warrantyMonths: s.warrantyMonths, sellerAr: s.merchant.displayNameAr, sellerEn: s.merchant.displayNameEn, city: s.location.city })),
    };
  });

  const token = randomToken(32);
  const review = await prisma.mechanicReview.create({
    data: {
      userId,
      vehicleId: input.vehicleId ?? null,
      tokenHash: sha256(token),
      snapshot: { vehicle, lines } as unknown as Prisma.InputJsonValue,
      note: input.note?.trim() || null,
      expiresAt: new Date(now.getTime() + REVIEW_TTL_MS),
    },
  });
  return { ...presentForCustomer(review, now), url: `${baseUrl.replace(/\/+$/, '')}/m/${token}` };
}

export function approvedLines(snapshot: ReviewSnapshot, decisions: ReviewDecision[] | null) {
  if (!decisions) return [];
  const out: { offerId: string; quantity: number }[] = [];
  for (const line of snapshot.lines) {
    const d = decisions.find((x) => x.offerId === line.offerId);
    if (d?.decision === 'APPROVED') out.push({ offerId: line.offerId, quantity: line.quantity });
    else if (d?.alternativeOfferId && line.alternatives.some((a) => a.offerId === d.alternativeOfferId)) out.push({ offerId: d.alternativeOfferId, quantity: line.quantity });
  }
  return out;
}

export function presentForCustomer(r: MechanicReview, now = new Date()) {
  const snapshot = r.snapshot as unknown as ReviewSnapshot;
  const decisions = (r.decisions ?? null) as unknown as ReviewDecision[] | null;
  return {
    id: r.id,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    expired: r.status === 'PENDING' && r.expiresAt.getTime() <= now.getTime(),
    respondedAt: r.respondedAt?.toISOString() ?? null,
    note: r.note,
    vehicle: snapshot.vehicle,
    lines: snapshot.lines.map((l) => ({ ...l, decision: decisions?.find((d) => d.offerId === l.offerId) ?? null })),
    mechanicNote: r.mechanicNote,
    workshop: r.workshopName || r.workshopPhone ? { name: r.workshopName, phone: r.workshopPhone } : null,
    approvedLines: approvedLines(snapshot, decisions),
  };
}

export async function listMechanicReviews(userId: string) {
  const rows = await prisma.mechanicReview.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30 });
  return rows.map((r) => presentForCustomer(r));
}

export async function getMechanicReview(userId: string, id: string) {
  const r = await prisma.mechanicReview.findFirst({ where: { id, userId } });
  if (!r) throw notFound('Mechanic review');
  return presentForCustomer(r);
}

// ── public (token) side

export async function findByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return prisma.mechanicReview.findUnique({ where: { tokenHash: sha256(token) } });
}

/** Saudi mobiles typed as 05XXXXXXXX / 9665… become +9665…; anything else must be 9–15 digits. */
export function normalizeWorkshopPhone(raw: string): string | null {
  const s = raw.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (!s) return null;
  if (/^05\d{8}$/.test(s)) return `+966${s.slice(1)}`;
  if (/^9665\d{8}$/.test(s)) return `+${s}`;
  if (/^\+?\d{9,15}$/.test(s)) return s;
  throw badRequest('INVALID_PHONE', 'رقم الجوال غير صحيح');
}

const PART_NUMBER_RE = /^[A-Za-z0-9][A-Za-z0-9 .\-/]{0,59}$/;

export type MechanicForm = Record<string, string | undefined>;

/** Parses and validates the public form against the review snapshot. Throws 400 with an Arabic message. */
export function parseMechanicForm(snapshot: ReviewSnapshot, form: MechanicForm) {
  const str = (k: string, max: number) => {
    const v = String(form[k] ?? '').trim();
    if (v.length > max) throw badRequest('TOO_LONG', 'أحد الحقول أطول من المسموح');
    return v;
  };
  const decisions: ReviewDecision[] = snapshot.lines.map((line, i) => {
    const d = form[`decision_${i}`];
    if (d === 'approve') return { offerId: line.offerId, decision: 'APPROVED' };
    if (d !== 'alternative') throw badRequest('DECISION_REQUIRED', 'اختر «مناسبة» أو «اقترح بديلاً» لكل قطعة');
    const text = str(`alt_text_${i}`, 200);
    const partNumber = str(`alt_pn_${i}`, 60);
    const alternativeOfferId = str(`alt_offer_${i}`, 64);
    if (partNumber && !PART_NUMBER_RE.test(partNumber)) throw badRequest('INVALID_PART_NUMBER', 'رقم القطعة البديلة غير صحيح');
    if (alternativeOfferId && !line.alternatives.some((a) => a.offerId === alternativeOfferId)) throw badRequest('INVALID_ALTERNATIVE', 'العرض البديل غير متاح لهذه القطعة');
    if (!text && !partNumber && !alternativeOfferId) throw badRequest('ALTERNATIVE_REQUIRED', 'اكتب البديل المقترح أو رقم القطعة أو اختر عرضاً آخر');
    return { offerId: line.offerId, decision: 'ALTERNATIVE', ...(text ? { text } : {}), ...(partNumber ? { partNumber } : {}), ...(alternativeOfferId ? { alternativeOfferId } : {}) };
  });
  return {
    decisions,
    workshopName: str('workshop_name', 80) || null,
    workshopPhone: normalizeWorkshopPhone(str('workshop_phone', 20)),
    mechanicNote: str('mechanic_note', 500) || null,
  };
}

export async function submitMechanicReview(review: MechanicReview, form: MechanicForm, now = new Date()) {
  if (review.status !== 'PENDING') throw new AppError(409, 'ALREADY_REVIEWED', 'تم إرسال المراجعة مسبقاً');
  if (review.expiresAt.getTime() <= now.getTime()) throw new AppError(410, 'EXPIRED', 'انتهت صلاحية الرابط');
  const snapshot = review.snapshot as unknown as ReviewSnapshot;
  const parsed = parseMechanicForm(snapshot, form);
  const status = parsed.decisions.every((d) => d.decision === 'APPROVED') ? 'APPROVED' : 'CHANGES_SUGGESTED';
  await withTx(async (tx) => {
    // Conditional on PENDING + unexpired: two submissions racing cannot both win.
    const r = await tx.mechanicReview.updateMany({
      where: { id: review.id, status: 'PENDING', expiresAt: { gt: now } },
      data: { status, decisions: parsed.decisions as unknown as Prisma.InputJsonValue, workshopName: parsed.workshopName, workshopPhone: parsed.workshopPhone, mechanicNote: parsed.mechanicNote, respondedAt: now },
    });
    if (!r.count) throw new AppError(409, 'ALREADY_REVIEWED', 'تم إرسال المراجعة مسبقاً');
    const who = parsed.workshopName ? `«${parsed.workshopName}»` : 'الميكانيكي';
    await notify(tx, {
      audience: 'CUSTOMER',
      userId: review.userId,
      type: 'mechanic_review.responded',
      title: status === 'APPROVED' ? 'الميكانيكي اعتمد قائمتك' : 'الميكانيكي اقترح تعديلات',
      body: status === 'APPROVED' ? `${who} أكّد أن القطع مناسبة. أضفها للسلة بنقرة.` : `${who} راجع قائمتك واقترح بدائل لبعض القطع.`,
      data: { mechanicReviewId: review.id, status },
    });
    await emit(tx, { type: 'mechanic_review.responded', entityType: 'MechanicReview', entityId: review.id, customerId: review.userId, payload: { status } });
  });
  return status;
}
