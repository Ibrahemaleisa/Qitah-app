/**
 * Maintenance schedule core: generic templates, due-status computation and kit component matching.
 *
 * The intervals are GENERAL GUIDANCE, not manufacturer data — every screen and the API label them
 * "check your owner's manual". Dependency-free on purpose: the customer app keeps an identical copy
 * (src/domain/maintenance-core.ts) for demo mode; a test checks the two files stay byte-identical.
 */

export type ServiceCode = 'OIL_CHANGE' | 'AIR_FILTER' | 'CABIN_FILTER' | 'BRAKE_PADS' | 'SPARK_PLUGS' | 'COOLANT';
export type ServiceStatus = 'due' | 'soon' | 'ok' | 'unknown';

export type KitComponent = {
  key: string;
  nameAr: string;
  nameEn: string;
  categoryIds: string[];
  keywords: string[];
  excludeKeywords?: string[];
  /** A delivered order line matching the primary component can propose a service record. */
  primary?: boolean;
};

export type ServiceVariant = { code: string; nameAr: string; nameEn: string; intervalKm: number };

export type MaintenanceTemplateData = {
  id: string;
  serviceCode: ServiceCode;
  makeId?: string | null;
  modelId?: string | null;
  nameAr: string;
  nameEn: string;
  noteAr: string;
  noteEn: string;
  intervalKm?: number | null;
  intervalMonths?: number | null;
  variants: ServiceVariant[];
  components: KitComponent[];
  sort: number;
};

export const MAINTENANCE_DISCLAIMER = {
  ar: 'إرشادات عامة — راجع دليل المالك لسيارتك.',
  en: "General guidance — check your owner's manual.",
};

/** Generic defaults (no manufacturer-specific intervals are invented). */
export const GENERIC_MAINTENANCE_TEMPLATES: MaintenanceTemplateData[] = [
  {
    id: 'generic-oil-change',
    serviceCode: 'OIL_CHANGE',
    nameAr: 'تغيير الزيت والفلتر',
    nameEn: 'Oil and filter change',
    noteAr: 'زيت صناعي (Synthetic): كل 10,000 كم، وزيت عادي: كل 5,000 كم، أو كل 6 أشهر أيهما أقرب.',
    noteEn: 'Synthetic oil: every 10,000 km; conventional oil: every 5,000 km; or every 6 months, whichever comes first.',
    intervalKm: 10000,
    intervalMonths: 6,
    variants: [
      { code: 'SYNTHETIC', nameAr: 'زيت صناعي', nameEn: 'Synthetic oil', intervalKm: 10000 },
      { code: 'CONVENTIONAL', nameAr: 'زيت عادي', nameEn: 'Conventional oil', intervalKm: 5000 },
    ],
    components: [
      { key: 'oil', nameAr: 'زيت المحرك', nameEn: 'Engine oil', categoryIds: ['oils'], keywords: ['engine oil', 'زيت محرك', 'oil', 'زيت'], excludeKeywords: ['coolant', 'تبريد', 'رديتر'], primary: true },
      { key: 'oilFilter', nameAr: 'فلتر الزيت', nameEn: 'Oil filter', categoryIds: ['filters'], keywords: ['oil filter', 'فلتر زيت'] },
    ],
    sort: 1,
  },
  {
    id: 'generic-cabin-filter',
    serviceCode: 'CABIN_FILTER',
    nameAr: 'فلتر المكيف',
    nameEn: 'Cabin (A/C) filter',
    noteAr: 'كل 15,000 كم أو 12 شهراً، وأقرب في الأجواء المغبرة.',
    noteEn: 'Every 15,000 km or 12 months; sooner in dusty conditions.',
    intervalKm: 15000,
    intervalMonths: 12,
    variants: [],
    components: [{ key: 'cabinFilter', nameAr: 'فلتر المكيف', nameEn: 'Cabin filter', categoryIds: ['filters'], keywords: ['cabin filter', 'cabin air filter', 'ac filter', 'فلتر مكيف'], primary: true }],
    sort: 2,
  },
  {
    id: 'generic-air-filter',
    serviceCode: 'AIR_FILTER',
    nameAr: 'فلتر الهواء',
    nameEn: 'Engine air filter',
    noteAr: 'كل 20,000 كم أو 12 شهراً، وأقرب في الأجواء المغبرة.',
    noteEn: 'Every 20,000 km or 12 months; sooner in dusty conditions.',
    intervalKm: 20000,
    intervalMonths: 12,
    variants: [],
    components: [{ key: 'airFilter', nameAr: 'فلتر الهواء', nameEn: 'Air filter', categoryIds: ['filters'], keywords: ['air filter', 'فلتر هواء'], excludeKeywords: ['cabin', 'مكيف'], primary: true }],
    sort: 3,
  },
  {
    id: 'generic-brake-pads',
    serviceCode: 'BRAKE_PADS',
    nameAr: 'فحص فحمات الفرامل',
    nameEn: 'Brake pad inspection',
    noteAr: 'فحص كل 20,000 كم؛ التغيير حسب سماكة الفحمات.',
    noteEn: 'Inspect every 20,000 km; replace according to pad thickness.',
    intervalKm: 20000,
    intervalMonths: null,
    variants: [],
    components: [{ key: 'brakePads', nameAr: 'فحمات الفرامل', nameEn: 'Brake pads', categoryIds: ['brakes'], keywords: ['brake pads', 'pads', 'فحمات'], primary: true }],
    sort: 4,
  },
  {
    id: 'generic-spark-plugs',
    serviceCode: 'SPARK_PLUGS',
    nameAr: 'البواجي',
    nameEn: 'Spark plugs',
    noteAr: 'بواجي عادية: كل 40,000 كم، وبواجي إيريديوم: حتى 100,000 كم.',
    noteEn: 'Standard plugs: every 40,000 km; iridium plugs: up to 100,000 km.',
    intervalKm: 40000,
    intervalMonths: null,
    variants: [
      { code: 'STANDARD', nameAr: 'بواجي عادية', nameEn: 'Standard plugs', intervalKm: 40000 },
      { code: 'IRIDIUM', nameAr: 'بواجي إيريديوم', nameEn: 'Iridium plugs', intervalKm: 100000 },
    ],
    components: [{ key: 'sparkPlugs', nameAr: 'البواجي', nameEn: 'Spark plugs', categoryIds: ['engine'], keywords: ['spark plug', 'بواجي', 'بوجي'], primary: true }],
    sort: 5,
  },
  {
    id: 'generic-coolant',
    serviceCode: 'COOLANT',
    nameAr: 'سائل التبريد',
    nameEn: 'Coolant',
    noteAr: 'كل 40,000 كم أو 24 شهراً.',
    noteEn: 'Every 40,000 km or 24 months.',
    intervalKm: 40000,
    intervalMonths: 24,
    variants: [],
    components: [{ key: 'coolant', nameAr: 'سائل التبريد', nameEn: 'Coolant', categoryIds: ['cooling', 'oils'], keywords: ['coolant', 'antifreeze', 'سائل تبريد', 'ماء رديتر'], primary: true }],
    sort: 6,
  },
];

/** Most specific active template per service: model > make > generic. */
export function templatesForVehicle<T extends Pick<MaintenanceTemplateData, 'serviceCode' | 'makeId' | 'modelId' | 'sort'>>(templates: T[], vehicle: { makeId?: string | null; modelId: string }): T[] {
  const best = new Map<string, { t: T; rank: number }>();
  for (const t of templates) {
    if (t.modelId && t.modelId !== vehicle.modelId) continue;
    if (t.makeId && t.makeId !== vehicle.makeId) continue;
    const rank = t.modelId ? 2 : t.makeId ? 1 : 0;
    const cur = best.get(t.serviceCode);
    if (!cur || rank > cur.rank) best.set(t.serviceCode, { t, rank });
  }
  return [...best.values()].map((x) => x.t).sort((a, b) => a.sort - b.sort);
}

const DAY_MS = 86_400_000;
const SOON_DAYS = 30;

function addMonthsUtc(d: Date, months: number): Date {
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), lastDay), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()));
}

export type StatusInput = {
  intervalKm?: number | null;
  intervalMonths?: number | null;
  variants?: ServiceVariant[];
  odometerKm?: number | null;
  /** The most recent service record for this service, if any. */
  last?: { id?: string; doneAtKm?: number | null; doneAt: string | Date; variant?: string | null } | null;
  now?: Date;
};

export type StatusResult = {
  status: ServiceStatus;
  /** Interval actually used (the recorded variant's interval when known). */
  intervalKm: number | null;
  nextDueKm: number | null;
  nextDueAt: string | null;
  remainingKm: number | null;
  remainingDays: number | null;
  /** Identifies the current due cycle: a new service record starts a new one (reminder idempotency). */
  cycleKey: string;
};

/**
 * due   — the km or the time interval has been reached;
 * soon  — within max(1,000 km, 10% of the interval) or 30 days;
 * ok    — tracked and not close;
 * unknown — not enough data (no record and no odometer below the first interval).
 */
export function computeServiceStatus(input: StatusInput): StatusResult {
  const now = input.now ?? new Date();
  const last = input.last ?? null;
  const odometer = input.odometerKm ?? null;
  const variantKm = last?.variant ? input.variants?.find((v) => v.code === last.variant)?.intervalKm : undefined;
  const intervalKm = variantKm ?? input.intervalKm ?? null;
  const intervalMonths = input.intervalMonths ?? null;

  let nextDueKm: number | null = null;
  if (intervalKm) {
    if (last && last.doneAtKm != null) nextDueKm = last.doneAtKm + intervalKm;
    // No record yet: a car still below its first interval is tracked from zero.
    else if (!last && odometer != null && odometer < intervalKm) nextDueKm = intervalKm;
  }
  const remainingKm = nextDueKm != null && odometer != null ? nextDueKm - odometer : null;

  let nextDueAt: Date | null = null;
  if (intervalMonths && last) nextDueAt = addMonthsUtc(new Date(last.doneAt), intervalMonths);
  const remainingDays = nextDueAt ? Math.floor((nextDueAt.getTime() - now.getTime()) / DAY_MS) : null;

  const soonKm = intervalKm ? Math.max(1000, Math.round(intervalKm * 0.1)) : 0;
  let status: ServiceStatus;
  if ((remainingKm != null && remainingKm <= 0) || (remainingDays != null && remainingDays <= 0)) status = 'due';
  else if ((remainingKm != null && remainingKm <= soonKm) || (remainingDays != null && remainingDays <= SOON_DAYS)) status = 'soon';
  else if (remainingKm != null || remainingDays != null) status = 'ok';
  else status = 'unknown';

  const cycleKey = last ? `r:${last.id ?? new Date(last.doneAt).toISOString()}` : 'initial';
  return { status, intervalKm, nextDueKm, nextDueAt: nextDueAt ? nextDueAt.toISOString() : null, remainingKm, remainingDays, cycleKey };
}

/** Lower is more urgent (for "your next maintenance"). */
export function statusRank(s: ServiceStatus): number {
  return s === 'due' ? 0 : s === 'soon' ? 1 : s === 'ok' ? 2 : 3;
}

const norm = (s: string) =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[ً-ٰٟـ]/g, '')
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .trim();

/** True when a product belongs to a kit component (category + keyword, minus exclusions). */
export function matchesComponent(product: { categoryId: string; keywords: string[]; nameAr?: string; nameEn?: string }, component: KitComponent): boolean {
  if (!component.categoryIds.includes(product.categoryId)) return false;
  const terms = [...(product.keywords ?? []), product.nameAr ?? '', product.nameEn ?? ''].map(norm).filter(Boolean);
  const has = (k: string) => terms.some((t) => t.includes(norm(k)));
  if ((component.excludeKeywords ?? []).some(has)) return false;
  return component.keywords.some(has);
}
