import type { VehicleMake, VehicleModel } from '@/domain/types';

/** SAMPLE DATA — a small demonstration vehicle catalog, not an authoritative fitment database. */
export const makes: VehicleMake[] = [
  {
    id: 'toyota',
    name: { ar: 'تويوتا', en: 'Toyota' },
    models: [
      { id: 'camry', makeId: 'toyota', name: { ar: 'كامري', en: 'Camry' }, yearFrom: 2018, yearTo: 2025, trims: ['LE', 'GLE', 'SE', 'Grande'], engines: ['2.5L I4', '3.5L V6'] },
      { id: 'land-cruiser', makeId: 'toyota', name: { ar: 'لاند كروزر', en: 'Land Cruiser' }, yearFrom: 2016, yearTo: 2025, trims: ['GX', 'GXR', 'VXR'], engines: ['4.0L V6', '4.6L V8', '3.5L V6 Twin-Turbo'] },
      { id: 'hilux', makeId: 'toyota', name: { ar: 'هايلكس', en: 'Hilux' }, yearFrom: 2016, yearTo: 2025, trims: ['Standard', 'GL', 'GLX'], engines: ['2.7L I4', '2.4L Diesel'] },
      { id: 'corolla', makeId: 'toyota', name: { ar: 'كورولا', en: 'Corolla' }, yearFrom: 2019, yearTo: 2025, trims: ['XLi', 'GLi'], engines: ['1.6L I4', '2.0L I4'] },
    ],
  },
  {
    id: 'hyundai',
    name: { ar: 'هيونداي', en: 'Hyundai' },
    models: [
      { id: 'elantra', makeId: 'hyundai', name: { ar: 'إلنترا', en: 'Elantra' }, yearFrom: 2019, yearTo: 2025, trims: ['Smart', 'Comfort', 'Limited'], engines: ['1.6L I4', '2.0L I4'] },
      { id: 'sonata', makeId: 'hyundai', name: { ar: 'سوناتا', en: 'Sonata' }, yearFrom: 2020, yearTo: 2025, trims: ['Smart', 'Limited'], engines: ['2.5L I4'] },
      { id: 'tucson', makeId: 'hyundai', name: { ar: 'توسان', en: 'Tucson' }, yearFrom: 2019, yearTo: 2025, trims: ['Smart', 'Comfort', 'Limited'], engines: ['2.0L I4', '1.6L Turbo'] },
      { id: 'accent', makeId: 'hyundai', name: { ar: 'أكسنت', en: 'Accent' }, yearFrom: 2018, yearTo: 2024, trims: ['Smart', 'Comfort'], engines: ['1.4L I4', '1.6L I4'] },
    ],
  },
  {
    id: 'nissan',
    name: { ar: 'نيسان', en: 'Nissan' },
    models: [
      { id: 'patrol', makeId: 'nissan', name: { ar: 'باترول', en: 'Patrol' }, yearFrom: 2016, yearTo: 2025, trims: ['XE', 'SE', 'LE', 'Nismo'], engines: ['4.0L V6', '5.6L V8'] },
      { id: 'altima', makeId: 'nissan', name: { ar: 'ألتيما', en: 'Altima' }, yearFrom: 2019, yearTo: 2025, trims: ['S', 'SV', 'SL'], engines: ['2.5L I4'] },
      { id: 'sunny', makeId: 'nissan', name: { ar: 'صني', en: 'Sunny' }, yearFrom: 2018, yearTo: 2025, trims: ['S', 'SV'], engines: ['1.6L I4'] },
    ],
  },
  {
    id: 'ford',
    name: { ar: 'فورد', en: 'Ford' },
    models: [
      { id: 'taurus', makeId: 'ford', name: { ar: 'توروس', en: 'Taurus' }, yearFrom: 2020, yearTo: 2025, trims: ['Trend', 'Titanium'], engines: ['1.5L EcoBoost', '2.0L EcoBoost'] },
      { id: 'f150', makeId: 'ford', name: { ar: 'إف-150', en: 'F-150' }, yearFrom: 2018, yearTo: 2025, trims: ['XL', 'XLT', 'Lariat', 'Raptor'], engines: ['3.5L EcoBoost', '5.0L V8'] },
    ],
  },
  {
    id: 'chevrolet',
    name: { ar: 'شيفروليه', en: 'Chevrolet' },
    models: [
      { id: 'tahoe', makeId: 'chevrolet', name: { ar: 'تاهو', en: 'Tahoe' }, yearFrom: 2018, yearTo: 2025, trims: ['LS', 'LT', 'Z71', 'High Country'], engines: ['5.3L V8', '6.2L V8'] },
    ],
  },
  {
    id: 'gmc',
    name: { ar: 'جي إم سي', en: 'GMC' },
    models: [
      { id: 'yukon', makeId: 'gmc', name: { ar: 'يوكن', en: 'Yukon' }, yearFrom: 2018, yearTo: 2025, trims: ['SLE', 'SLT', 'Denali'], engines: ['5.3L V8', '6.2L V8'] },
    ],
  },
  {
    id: 'kia',
    name: { ar: 'كيا', en: 'Kia' },
    models: [
      { id: 'k5', makeId: 'kia', name: { ar: 'كي 5', en: 'K5' }, yearFrom: 2021, yearTo: 2025, trims: ['LX', 'EX', 'GT-Line'], engines: ['2.5L I4', '1.6L Turbo'] },
      { id: 'sportage', makeId: 'kia', name: { ar: 'سبورتاج', en: 'Sportage' }, yearFrom: 2019, yearTo: 2025, trims: ['LX', 'EX', 'GT-Line'], engines: ['2.0L I4', '1.6L Turbo'] },
    ],
  },
  {
    id: 'lexus',
    name: { ar: 'لكزس', en: 'Lexus' },
    models: [
      { id: 'lx', makeId: 'lexus', name: { ar: 'إل إكس', en: 'LX' }, yearFrom: 2016, yearTo: 2025, trims: ['LX 570', 'LX 600'], engines: ['5.7L V8', '3.5L V6 Twin-Turbo'] },
    ],
  },
];

const modelIndex = new Map<string, VehicleModel>();
for (const make of makes) for (const model of make.models) modelIndex.set(model.id, model);

export function getModel(id: string): VehicleModel | undefined {
  return modelIndex.get(id);
}

export function getMake(id: string): VehicleMake | undefined {
  return makes.find((m) => m.id === id);
}
