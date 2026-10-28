import type {
  Address,
  Category,
  CategoryId,
  CityId,
  Condition,
  Fitment,
  L10n,
  Offer,
  PartArtKind,
  Product,
  Seller,
  Spec,
  Vehicle,
  VehicleMake,
} from '@/domain/types';

import { halalasToSar, optionalHalalasToSar } from './money';
import type { ApiAddress, ApiCategory, ApiMake, ApiOffer, ApiProduct, ApiSeller, ApiVehicle } from './types';

/**
 * Adapters: API wire shapes → the app's existing domain types, so screens keep working unchanged.
 * They are defensive (partial data never crashes a screen) and conservative (unknown values never
 * upgrade into a stronger claim: an unknown fitment source is treated as seller-reported, not catalog).
 */

const CITY_IDS: CityId[] = ['riyadh', 'jeddah', 'dammam', 'khobar', 'makkah', 'madinah'];
const ART_KINDS: PartArtKind[] = ['rotor', 'pads', 'oilFilter', 'airFilter', 'sparkPlug', 'battery', 'shock', 'headlight', 'radiator', 'oil', 'mirror', 'belt', 'alternator', 'bumper', 'pump'];
const CONDITIONS: Condition[] = ['new', 'used', 'refurbished'];

export function toCityId(value: unknown): CityId | undefined {
  const v = String(value ?? '').toLowerCase();
  return (CITY_IDS as string[]).includes(v) ? (v as CityId) : undefined;
}

export function toArt(value: unknown, fallback: PartArtKind = 'pump'): PartArtKind {
  return (ART_KINDS as string[]).includes(String(value)) ? (value as PartArtKind) : fallback;
}

export function toCondition(value: unknown): Condition {
  const v = String(value ?? '').toLowerCase();
  // Unknown conditions are never presented as "new".
  return (CONDITIONS as string[]).includes(v) ? (v as Condition) : 'used';
}

function l10n(value: unknown, fallback = ''): L10n {
  if (value && typeof value === 'object' && 'ar' in value) {
    const v = value as { ar?: unknown; en?: unknown };
    const ar = typeof v.ar === 'string' ? v.ar : fallback;
    const en = typeof v.en === 'string' && v.en ? v.en : ar;
    return { ar, en };
  }
  if (typeof value === 'string') return { ar: value, en: value };
  return { ar: fallback, en: fallback };
}

export function toCategory(c: ApiCategory): Category {
  return { id: c.id as CategoryId, name: l10n(c.name, c.id), art: toArt(c.art) };
}

export function toMake(m: ApiMake): VehicleMake {
  return {
    id: m.id,
    name: l10n(m.name, m.id),
    models: (m.models ?? []).map((x) => ({
      id: x.id,
      makeId: x.makeId ?? m.id,
      name: l10n(x.name, x.id),
      yearFrom: x.yearFrom,
      yearTo: x.yearTo,
      trims: x.trims ?? [],
      engines: x.engines ?? [],
    })),
  };
}

export function toOffer(o: ApiOffer): Offer {
  const dispatch = Array.isArray(o.dispatchDays) && o.dispatchDays.length >= 2 ? o.dispatchDays : [0, 1];
  const purchasable = o.purchasable !== false;
  const note = o.noteAr || o.noteEn ? { ar: o.noteAr ?? o.noteEn ?? '', en: o.noteEn ?? o.noteAr ?? '' } : undefined;
  return {
    id: o.id,
    productId: o.productId,
    sellerId: o.sellerId,
    price: halalasToSar(o.priceHalalas),
    compareAtPrice: o.compareAtHalalas && o.compareAtHalalas > o.priceHalalas ? optionalHalalasToSar(o.compareAtHalalas) : undefined,
    // `available` = on hand − reserved, computed by the server. Never negative.
    stock: purchasable ? Math.max(0, Math.floor(o.available ?? 0)) : 0,
    condition: toCondition(o.condition),
    warrantyMonths: Math.max(0, o.warrantyMonths ?? 0),
    dispatchDays: [Number(dispatch[0]) || 0, Number(dispatch[1]) || 0],
    // Delivery methods and fees come from live carrier quotes at checkout, not from the offer.
    deliveryOptions: [],
    note,
    originCity: toCityId(o.originCity),
    unavailable: !purchasable || undefined,
  };
}

function toSpecs(value: unknown): Spec[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((s): s is { label: unknown; value: unknown } => !!s && typeof s === 'object' && 'label' in s && 'value' in s)
    .map((s) => ({ label: l10n(s.label), value: typeof s.value === 'string' ? s.value : l10n(s.value) }));
}

function toFitment(f: ApiProduct['fitment'][number]): Fitment {
  return {
    modelId: f.modelId,
    yearFrom: f.yearFrom,
    yearTo: f.yearTo,
    engines: f.engines && f.engines.length ? f.engines : undefined,
    // Only an explicit catalog source counts as catalog-backed.
    source: f.source === 'catalog' ? 'catalog' : 'seller',
  };
}

export function toProduct(p: ApiProduct, categoryArt?: PartArtKind): Product {
  return {
    id: p.id,
    name: l10n(p.name, p.id),
    categoryId: p.categoryId as CategoryId,
    brand: p.brand ?? '',
    origin: p.origin === 'oem' ? 'oem' : 'aftermarket',
    partNumber: p.partNumber ?? '',
    oemReferences: Array.isArray(p.oemReferences) ? p.oemReferences : [],
    description: l10n(p.description),
    specs: toSpecs(p.specs),
    universal: p.universal ? { note: l10n(p.universal.note) } : undefined,
    fitment: Array.isArray(p.fitment) ? p.fitment.filter((f) => f && f.modelId).map(toFitment) : [],
    art: toArt(p.art, categoryArt),
    keywords: Array.isArray(p.keywords) ? p.keywords : [],
    // No verified reviews exist yet: never invent a rating.
    rating: null,
  };
}

export function toSeller(s: ApiSeller): Seller {
  return {
    id: s.id,
    name: l10n(s.name, s.id),
    city: toCityId(s.city) ?? (s.city as CityId),
    verifiedBusiness: !!s.verifiedBusiness,
    joinedYear: s.joinedYear,
    rating: null,
    fulfilledOrders: s.fulfilledOrders ?? 0,
    onTimeRate: s.onTimeRate ?? null,
    responseHours: s.responseHours ?? 24,
    supportsWorkshopDelivery: !!s.supportsWorkshopDelivery,
    specialty: l10n(s.specialty),
  };
}

export function toVehicle(v: ApiVehicle, makeIdForModel: (modelId: string) => string | undefined): Vehicle {
  return {
    id: v.id,
    makeId: makeIdForModel(v.modelId) ?? '',
    modelId: v.modelId,
    year: v.year,
    trim: v.trim ?? '',
    engine: v.engine,
    vin: v.vin,
    odometerKm: typeof v.odometerKm === 'number' ? v.odometerKm : undefined,
    addedAt: v.addedAt,
  };
}

export function toAddress(a: ApiAddress): Address {
  return {
    id: a.id,
    kind: String(a.kind).toLowerCase() === 'workshop' ? 'workshop' : 'home',
    label: a.label,
    city: toCityId(a.city) ?? (a.city as CityId),
    district: a.district,
    street: a.street,
    details: a.details ?? undefined,
    contactName: a.contactName,
    phone: a.phone,
    workshopName: a.workshopName ?? undefined,
  };
}

export function fromAddress(a: Omit<Address, 'id'>): Omit<ApiAddress, 'id'> {
  return {
    kind: a.kind,
    label: a.label,
    city: a.city,
    district: a.district,
    street: a.street,
    ...(a.details ? { details: a.details } : {}),
    contactName: a.contactName,
    phone: a.phone,
    ...(a.kind === 'workshop' && a.workshopName ? { workshopName: a.workshopName } : {}),
  };
}
