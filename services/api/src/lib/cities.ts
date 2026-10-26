/** Supported Phase 1 cities. Keys match the customer app's CityId. */
export const CITIES = {
  riyadh: { ar: 'الرياض', en: 'Riyadh', region: 'central' },
  jeddah: { ar: 'جدة', en: 'Jeddah', region: 'western' },
  makkah: { ar: 'مكة المكرمة', en: 'Makkah', region: 'western' },
  madinah: { ar: 'المدينة المنورة', en: 'Madinah', region: 'western' },
  dammam: { ar: 'الدمام', en: 'Dammam', region: 'eastern' },
  khobar: { ar: 'الخبر', en: 'Khobar', region: 'eastern' },
} as const;

export type CityId = keyof typeof CITIES;
export const CITY_IDS = Object.keys(CITIES) as [CityId, ...CityId[]];
