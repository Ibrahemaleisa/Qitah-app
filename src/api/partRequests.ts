/**
 * Part requests ("اطلب قطعة" / RFQ): wire types, endpoints and adapters to app shapes.
 * Money arrives as integer halalas and is converted once for display (see ./money).
 */
import type { CityId, Condition, L10n, Offer, PartArtKind, Product, Seller } from '@/domain/types';

import { toCityId, toCondition, toOffer, toProduct, toSeller } from './adapters';
import { api } from './client';
import { halalasToSar, optionalHalalasToSar } from './money';
import type { ApiProduct, ApiSeller } from './types';

// ── wire
export type ApiPartRequestStatus = 'OPEN' | 'QUOTED' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';

export type ApiPartRequestCore = {
  id: string;
  number: string;
  status: ApiPartRequestStatus | string;
  vehicle: { makeId: string; modelId: string; year: number; engine: string | null; vin: string | null; label: L10n };
  description: string;
  partNumber: string | null;
  quantity: number;
  preferredCondition: string;
  preferredOrigin: string;
  city: string;
  photoCount: number;
  createdAt: string;
  expiresAt: string;
  firstQuotedAt: string | null;
  acceptedAt: string | null;
};

export type ApiPartRequestSummary = ApiPartRequestCore & { quoteCount: number; bestPriceHalalas: number | null };

export type ApiPartQuote = {
  id: string;
  status: string;
  expired: boolean;
  merchant: { id: string; name: L10n; city: string | null; verifiedBusiness: boolean };
  seller: ApiSeller | null;
  originCity: string | null;
  part: { productId: string | null; name: L10n; brand: string | null; partNumber: string | null; origin: string | null };
  condition: string;
  priceHalalas: number;
  quantity: number;
  warrantyMonths: number;
  dispatchDays: number[];
  note: string | null;
  validUntil: string;
  photoUrl: string | null;
  offerId: string | null;
};

export type ApiPartRequestDetail = ApiPartRequestCore & { photos: { url: string }[]; quotes: ApiPartQuote[] };

export type ApiAcceptResponse = { requestId: string; quoteId: string; offerId: string; quantity: number; product: ApiProduct | null; seller: ApiSeller | null };
export type ApiPrivateCatalog = { products: ApiProduct[]; sellers: ApiSeller[] };
export type UploadTarget = { key: string; uploadUrl: string; method: 'PUT'; headers: Record<string, string>; expiresIn: number };

export type CreatePartRequestBody = {
  vehicleId?: string;
  vehicle?: { modelId: string; year: number; engine?: string; vin?: string };
  description: string;
  partNumber?: string;
  quantity?: number;
  photoKeys?: string[];
  preferredCondition?: 'ANY' | 'NEW' | 'USED';
  preferredOrigin?: 'ANY' | 'OEM' | 'AFTERMARKET';
  addressId?: string;
  city?: string;
};

const auth = { auth: 'required' as const };
const enc = encodeURIComponent;

export const partRequestApi = {
  upload: (input: { contentType: string; sizeBytes: number; fileName: string }) => api.post<UploadTarget>('/v1/me/uploads', { purpose: 'part-request', ...input }, auth),
  create: (body: CreatePartRequestBody) => api.post<ApiPartRequestDetail>('/v1/me/part-requests', body, auth),
  list: () => api.get<{ requests: ApiPartRequestSummary[] }>('/v1/me/part-requests', auth),
  get: (id: string) => api.get<ApiPartRequestDetail>(`/v1/me/part-requests/${enc(id)}`, auth),
  cancel: (id: string) => api.post<ApiPartRequestDetail>(`/v1/me/part-requests/${enc(id)}/cancel`, {}, auth),
  accept: (id: string, quoteId: string) => api.post<ApiAcceptResponse>(`/v1/me/part-requests/${enc(id)}/quotes/${enc(quoteId)}/accept`, {}, auth),
  privateOffers: () => api.get<ApiPrivateCatalog>('/v1/me/private-offers', auth),
};

// ── app shapes
export type PartRequestStatus = 'open' | 'quoted' | 'accepted' | 'expired' | 'cancelled';
export type QuoteStatus = 'active' | 'accepted' | 'withdrawn' | 'declined' | 'expired';
export type ConditionPreference = 'any' | 'new' | 'used';
export type OriginPreference = 'any' | 'oem' | 'aftermarket';

export type PartRequestSummary = {
  id: string;
  number: string;
  status: PartRequestStatus;
  vehicleLabel: L10n;
  modelId: string;
  year: number;
  engine?: string;
  description: string;
  partNumber?: string;
  quantity: number;
  city?: CityId;
  preferredCondition: ConditionPreference;
  preferredOrigin: OriginPreference;
  photoCount: number;
  createdAt: number;
  expiresAt: number;
  firstQuotedAt?: number;
  quoteCount: number;
  /** SAR (display only). */
  bestPrice?: number;
};

export type PartQuote = {
  id: string;
  status: QuoteStatus;
  /** Past `validUntil` (the server also expires it within a minute). */
  expired: boolean;
  sellerId: string;
  sellerName: L10n;
  sellerCity?: CityId;
  verifiedSeller: boolean;
  seller?: Seller;
  originCity?: CityId;
  productId?: string;
  partName: L10n;
  brand?: string;
  partNumber?: string;
  origin?: 'oem' | 'aftermarket';
  condition: Condition;
  /** SAR (display only). */
  price: number;
  quantity: number;
  warrantyMonths: number;
  dispatchDays: [number, number];
  note?: string;
  photoUrl?: string;
  validUntil: number;
  offerId?: string;
};

export type PartRequestDetail = PartRequestSummary & { photos: string[]; quotes: PartQuote[] };

const STATUSES: PartRequestStatus[] = ['open', 'quoted', 'accepted', 'expired', 'cancelled'];
const QUOTE_STATUSES: QuoteStatus[] = ['active', 'accepted', 'withdrawn', 'declined', 'expired'];

const ts = (iso: string | null | undefined) => {
  const t = iso ? Date.parse(iso) : NaN;
  return Number.isFinite(t) ? t : undefined;
};

export function toRequestStatus(v: unknown): PartRequestStatus {
  const s = String(v ?? '').toLowerCase();
  // Unknown statuses are shown as closed (expired) rather than inviting new action.
  return (STATUSES as string[]).includes(s) ? (s as PartRequestStatus) : 'expired';
}

function toQuoteStatus(v: unknown): QuoteStatus {
  const s = String(v ?? '').toLowerCase();
  return (QUOTE_STATUSES as string[]).includes(s) ? (s as QuoteStatus) : 'expired';
}

const pref = <T extends string>(v: unknown, allowed: T[]): T => ((allowed as string[]).includes(String(v).toLowerCase()) ? (String(v).toLowerCase() as T) : allowed[0]);
const textOr = (v: string | null | undefined) => (v && v.trim() ? v : undefined);

function core(r: ApiPartRequestCore): Omit<PartRequestSummary, 'quoteCount' | 'bestPrice'> {
  return {
    id: r.id,
    number: r.number,
    status: toRequestStatus(r.status),
    vehicleLabel: r.vehicle?.label ?? { ar: '', en: '' },
    modelId: r.vehicle?.modelId ?? '',
    year: r.vehicle?.year ?? 0,
    engine: textOr(r.vehicle?.engine),
    description: r.description ?? '',
    partNumber: textOr(r.partNumber),
    quantity: Math.max(1, r.quantity ?? 1),
    city: toCityId(r.city),
    preferredCondition: pref<ConditionPreference>(r.preferredCondition, ['any', 'new', 'used']),
    preferredOrigin: pref<OriginPreference>(r.preferredOrigin, ['any', 'oem', 'aftermarket']),
    photoCount: r.photoCount ?? 0,
    createdAt: ts(r.createdAt) ?? 0,
    expiresAt: ts(r.expiresAt) ?? 0,
    firstQuotedAt: ts(r.firstQuotedAt),
  };
}

export function toPartRequestSummary(r: ApiPartRequestSummary): PartRequestSummary {
  return { ...core(r), quoteCount: r.quoteCount ?? 0, bestPrice: optionalHalalasToSar(r.bestPriceHalalas) };
}

export function toPartQuote(q: ApiPartQuote, now = Date.now()): PartQuote {
  const dispatch = Array.isArray(q.dispatchDays) && q.dispatchDays.length >= 2 ? q.dispatchDays : [0, 1];
  const validUntil = ts(q.validUntil) ?? 0;
  return {
    id: q.id,
    status: toQuoteStatus(q.status),
    expired: !!q.expired || validUntil <= now,
    sellerId: q.merchant?.id ?? q.seller?.id ?? '',
    sellerName: q.merchant?.name ?? q.seller?.name ?? { ar: '', en: '' },
    sellerCity: toCityId(q.merchant?.city),
    verifiedSeller: !!q.merchant?.verifiedBusiness,
    seller: q.seller ? toSeller(q.seller) : undefined,
    originCity: toCityId(q.originCity),
    productId: q.part?.productId ?? undefined,
    partName: q.part?.name ?? { ar: '', en: '' },
    brand: textOr(q.part?.brand),
    partNumber: textOr(q.part?.partNumber),
    origin: q.part?.origin === 'oem' ? 'oem' : q.part?.origin === 'aftermarket' ? 'aftermarket' : undefined,
    condition: toCondition(q.condition),
    price: halalasToSar(q.priceHalalas),
    quantity: Math.max(1, q.quantity ?? 1),
    warrantyMonths: Math.max(0, q.warrantyMonths ?? 0),
    dispatchDays: [Number(dispatch[0]) || 0, Number(dispatch[1]) || 0],
    note: textOr(q.note),
    photoUrl: textOr(q.photoUrl),
    validUntil,
    offerId: q.offerId ?? undefined,
  };
}

export function toPartRequestDetail(r: ApiPartRequestDetail, now = Date.now()): PartRequestDetail {
  const quotes = (r.quotes ?? []).map((q) => toPartQuote(q, now)).sort((a, b) => a.price - b.price);
  const live = quotes.filter((q) => q.status === 'active' || q.status === 'accepted');
  return {
    ...core(r),
    photos: (r.photos ?? []).map((p) => p.url).filter(Boolean),
    quotes,
    quoteCount: live.length,
    bestPrice: live.length ? Math.min(...live.map((q) => q.price)) : undefined,
  };
}

/** True when the customer can still accept this quote. */
export function canAccept(request: Pick<PartRequestSummary, 'status' | 'expiresAt'>, quote: Pick<PartQuote, 'status' | 'expired'>, now = Date.now()) {
  return (request.status === 'open' || request.status === 'quoted') && request.expiresAt > now && quote.status === 'active' && !quote.expired;
}

/** The customer's private offers (accepted quotes) in app catalog shapes. */
export function toPrivateCatalog(r: { products: readonly (ApiProduct | null)[]; sellers: readonly (ApiSeller | null)[] }, artFor: (categoryId: string) => PartArtKind | undefined = () => undefined) {
  const products = (r.products ?? []).filter((p): p is ApiProduct => !!p);
  return {
    products: products.map((p): Product => toProduct(p, artFor(p.categoryId))),
    offers: products.flatMap((p) => (p.offers ?? []).map((o): Offer => toOffer(o))),
    sellers: (r.sellers ?? []).filter((s): s is ApiSeller => !!s).map((s): Seller => toSeller(s)),
  };
}

/** Photos are sent as JPEG/PNG only; anything else is refused before upload. */
export function photoContentType(mime: string | null | undefined, uri: string): 'image/jpeg' | 'image/png' | null {
  const m = (mime ?? '').toLowerCase();
  if (m === 'image/jpeg' || m === 'image/jpg') return 'image/jpeg';
  if (m === 'image/png') return 'image/png';
  if (!m) {
    if (/\.png(\?|$)/i.test(uri)) return 'image/png';
    if (/\.jpe?g(\?|$)/i.test(uri)) return 'image/jpeg';
  }
  return null;
}
