/**
 * Offline, PARTIAL VIN decoding (ISO 3779 / 3780 + the North American check digit).
 *
 * What it can tell: whether the VIN is well formed, the manufacturer (from the WMI, the first three
 * characters) and the model year (position 10). What it never claims: the model, engine or trim —
 * those need a licensed decoder, so the customer still picks them.
 *
 * Dependency-free on purpose: the customer app keeps an identical copy (src/lib/vin.ts) for demo mode,
 * and a shared fixture file checks both give the same answers.
 */

export type VinConfidence = 'high' | 'medium' | 'low' | 'none';
export type VinCheckDigit = 'ok' | 'mismatch' | 'not_applicable';
export type VinRegion = 'north_america' | 'japan' | 'korea' | 'china' | 'south_asia' | 'europe' | 'oceania' | 'south_america' | 'africa' | 'other';

export type VinDecode = {
  vin: string;
  valid: boolean;
  /** Catalog make id (e.g. "toyota") when the WMI belongs to a make Qitah lists. */
  make?: string;
  /** Manufacturer name from the WMI table, also for makes outside the catalog. */
  manufacturer?: string;
  wmi?: string;
  region?: VinRegion;
  modelYear?: number;
  checkDigit?: VinCheckDigit;
  confidence: VinConfidence;
  /** Machine-readable reasons; the app localises them. */
  reasons: string[];
  note: string;
  noteAr: string;
};

const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

/**
 * WMI → manufacturer. `make` is set only for makes present in the Qitah vehicle catalog.
 * Sources: published SAE/NHTSA WMI assignments for the common plants serving the Saudi market.
 */
export const WMI_TABLE: Record<string, { manufacturer: string; make?: string }> = {
  // Toyota — Japan, Thailand, Indonesia, South Africa, North America, Australia, Europe, Argentina
  JTD: { manufacturer: 'Toyota', make: 'toyota' },
  JTE: { manufacturer: 'Toyota', make: 'toyota' },
  JTM: { manufacturer: 'Toyota', make: 'toyota' },
  JTN: { manufacturer: 'Toyota', make: 'toyota' },
  JTK: { manufacturer: 'Toyota', make: 'toyota' },
  JTL: { manufacturer: 'Toyota', make: 'toyota' },
  JTF: { manufacturer: 'Toyota', make: 'toyota' },
  JT2: { manufacturer: 'Toyota', make: 'toyota' },
  JT3: { manufacturer: 'Toyota', make: 'toyota' },
  JT4: { manufacturer: 'Toyota', make: 'toyota' },
  MR0: { manufacturer: 'Toyota', make: 'toyota' },
  MR1: { manufacturer: 'Toyota', make: 'toyota' },
  MR2: { manufacturer: 'Toyota', make: 'toyota' },
  MHF: { manufacturer: 'Toyota', make: 'toyota' },
  AHT: { manufacturer: 'Toyota', make: 'toyota' },
  '4T1': { manufacturer: 'Toyota', make: 'toyota' },
  '4T3': { manufacturer: 'Toyota', make: 'toyota' },
  '4T4': { manufacturer: 'Toyota', make: 'toyota' },
  '5TD': { manufacturer: 'Toyota', make: 'toyota' },
  '5TF': { manufacturer: 'Toyota', make: 'toyota' },
  '2T1': { manufacturer: 'Toyota', make: 'toyota' },
  '2T3': { manufacturer: 'Toyota', make: 'toyota' },
  '6T1': { manufacturer: 'Toyota', make: 'toyota' },
  SB1: { manufacturer: 'Toyota', make: 'toyota' },
  NMT: { manufacturer: 'Toyota', make: 'toyota' },
  '8AJ': { manufacturer: 'Toyota', make: 'toyota' },
  // Lexus
  JTH: { manufacturer: 'Lexus', make: 'lexus' },
  JTJ: { manufacturer: 'Lexus', make: 'lexus' },
  '2T2': { manufacturer: 'Lexus', make: 'lexus' },
  '58A': { manufacturer: 'Lexus', make: 'lexus' },
  // Hyundai
  KMH: { manufacturer: 'Hyundai', make: 'hyundai' },
  KM8: { manufacturer: 'Hyundai', make: 'hyundai' },
  KMF: { manufacturer: 'Hyundai', make: 'hyundai' },
  '5NP': { manufacturer: 'Hyundai', make: 'hyundai' },
  '5NM': { manufacturer: 'Hyundai', make: 'hyundai' },
  MAL: { manufacturer: 'Hyundai', make: 'hyundai' },
  NLH: { manufacturer: 'Hyundai', make: 'hyundai' },
  TMA: { manufacturer: 'Hyundai', make: 'hyundai' },
  // Kia
  KNA: { manufacturer: 'Kia', make: 'kia' },
  KND: { manufacturer: 'Kia', make: 'kia' },
  KNC: { manufacturer: 'Kia', make: 'kia' },
  '5XY': { manufacturer: 'Kia', make: 'kia' },
  '5XX': { manufacturer: 'Kia', make: 'kia' },
  U5Y: { manufacturer: 'Kia', make: 'kia' },
  '3KP': { manufacturer: 'Kia', make: 'kia' },
  // Nissan
  JN1: { manufacturer: 'Nissan', make: 'nissan' },
  JN8: { manufacturer: 'Nissan', make: 'nissan' },
  JN6: { manufacturer: 'Nissan', make: 'nissan' },
  '1N4': { manufacturer: 'Nissan', make: 'nissan' },
  '1N6': { manufacturer: 'Nissan', make: 'nissan' },
  '5N1': { manufacturer: 'Nissan', make: 'nissan' },
  '3N1': { manufacturer: 'Nissan', make: 'nissan' },
  '3N6': { manufacturer: 'Nissan', make: 'nissan' },
  MDH: { manufacturer: 'Nissan', make: 'nissan' },
  MNT: { manufacturer: 'Nissan', make: 'nissan' },
  SJN: { manufacturer: 'Nissan', make: 'nissan' },
  VSK: { manufacturer: 'Nissan', make: 'nissan' },
  // Ford
  '1FA': { manufacturer: 'Ford', make: 'ford' },
  '1FB': { manufacturer: 'Ford', make: 'ford' },
  '1FC': { manufacturer: 'Ford', make: 'ford' },
  '1FD': { manufacturer: 'Ford', make: 'ford' },
  '1FM': { manufacturer: 'Ford', make: 'ford' },
  '1FT': { manufacturer: 'Ford', make: 'ford' },
  '2FA': { manufacturer: 'Ford', make: 'ford' },
  '2FM': { manufacturer: 'Ford', make: 'ford' },
  '2FT': { manufacturer: 'Ford', make: 'ford' },
  '3FA': { manufacturer: 'Ford', make: 'ford' },
  '3FT': { manufacturer: 'Ford', make: 'ford' },
  WF0: { manufacturer: 'Ford', make: 'ford' },
  MAJ: { manufacturer: 'Ford', make: 'ford' },
  NM0: { manufacturer: 'Ford', make: 'ford' },
  '6FP': { manufacturer: 'Ford', make: 'ford' },
  // Chevrolet
  '1G1': { manufacturer: 'Chevrolet', make: 'chevrolet' },
  '1GB': { manufacturer: 'Chevrolet', make: 'chevrolet' },
  '1GC': { manufacturer: 'Chevrolet', make: 'chevrolet' },
  '1GN': { manufacturer: 'Chevrolet', make: 'chevrolet' },
  '2G1': { manufacturer: 'Chevrolet', make: 'chevrolet' },
  '3G1': { manufacturer: 'Chevrolet', make: 'chevrolet' },
  '3GC': { manufacturer: 'Chevrolet', make: 'chevrolet' },
  '3GN': { manufacturer: 'Chevrolet', make: 'chevrolet' },
  KL1: { manufacturer: 'Chevrolet', make: 'chevrolet' },
  // GMC
  '1GT': { manufacturer: 'GMC', make: 'gmc' },
  '1GK': { manufacturer: 'GMC', make: 'gmc' },
  '1GD': { manufacturer: 'GMC', make: 'gmc' },
  '2GT': { manufacturer: 'GMC', make: 'gmc' },
  '3GT': { manufacturer: 'GMC', make: 'gmc' },
  '2GK': { manufacturer: 'GMC', make: 'gmc' },
  // Recognised manufacturers that Qitah does not list yet (decoded, but no catalog make).
  JHM: { manufacturer: 'Honda' },
  '1HG': { manufacturer: 'Honda' },
  JA3: { manufacturer: 'Mitsubishi' },
  JA4: { manufacturer: 'Mitsubishi' },
  MMB: { manufacturer: 'Mitsubishi' },
  JM1: { manufacturer: 'Mazda' },
  JM3: { manufacturer: 'Mazda' },
  JS2: { manufacturer: 'Suzuki' },
  MA3: { manufacturer: 'Suzuki' },
  JAA: { manufacturer: 'Isuzu' },
  MPA: { manufacturer: 'Isuzu' },
  WDB: { manufacturer: 'Mercedes-Benz' },
  WDD: { manufacturer: 'Mercedes-Benz' },
  W1K: { manufacturer: 'Mercedes-Benz' },
  WBA: { manufacturer: 'BMW' },
  WVW: { manufacturer: 'Volkswagen' },
  LSJ: { manufacturer: 'MG' },
};

const TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8, J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9, S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];
/** Position-10 year codes; index 0 = 1980 (and 2010, 2040 — a 30-year cycle). */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

export function normalizeVin(input: string): string {
  return String(input ?? '').toUpperCase().replace(/[\s-]/g, '');
}

/** ISO 3779 shape: 17 characters, digits and capital letters except I, O and Q. */
export function isWellFormedVin(vin: string): boolean {
  return VIN_RE.test(normalizeVin(vin));
}

/** The expected position-9 check digit ('0'–'9' or 'X'). */
export function vinCheckDigit(vin: string): string {
  const v = normalizeVin(vin);
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const c = v[i];
    const n = c >= '0' && c <= '9' ? Number(c) : (TRANSLIT[c] ?? 0);
    sum += n * WEIGHTS[i];
  }
  const r = sum % 11;
  return r === 10 ? 'X' : String(r);
}

export function vinRegion(vin: string): VinRegion {
  const a = vin[0];
  const b = vin[1];
  if (a >= '1' && a <= '5') return 'north_america';
  if (a === 'J') return 'japan';
  if (a === 'K' && b >= 'L' && b <= 'R') return 'korea';
  if (a === 'L') return 'china';
  if (a === 'M') return 'south_asia';
  if (a >= 'S' && a <= 'Z') return 'europe';
  if (a === '6' || a === '7') return 'oceania';
  if (a === '8' || a === '9') return 'south_america';
  if (a >= 'A' && a <= 'H') return 'africa';
  return 'other';
}

/** Every year a position-10 code can stand for (one per 30-year cycle), oldest first. */
export function modelYearCandidates(code: string): number[] {
  const i = YEAR_CODES.indexOf(code);
  if (i < 0) return [];
  return [1980 + i, 2010 + i, 2040 + i];
}

/**
 * Model year from position 10.
 * - North American VINs: position 7 disambiguates the cycle (digit → 1980–2009, letter → 2010–2039).
 * - Elsewhere: the most recent candidate that is not later than next year.
 */
export function decodeModelYear(vin: string, now = new Date()): { year?: number; method?: 'na_position7' | 'most_recent' } {
  const candidates = modelYearCandidates(vin[9]);
  if (!candidates.length) return {};
  const maxYear = now.getUTCFullYear() + 1;
  if (vinRegion(vin) === 'north_america') {
    const p7 = vin[6];
    const year = p7 >= '0' && p7 <= '9' ? candidates[0] : candidates[1];
    return year <= maxYear ? { year, method: 'na_position7' } : {};
  }
  const plausible = candidates.filter((y) => y <= maxYear);
  return plausible.length ? { year: plausible[plausible.length - 1], method: 'most_recent' } : {};
}

const NOTES: Record<string, { en: string; ar: string }> = {
  invalid_format: { en: 'A VIN has 17 characters: digits and letters except I, O and Q.', ar: 'رقم الهيكل 17 خانة: أرقام وحروف إنجليزية دون I و O و Q.' },
  check_digit_failed: { en: 'The check digit (9th character) does not match — please re-check the VIN.', ar: 'خانة التحقق (التاسعة) لا تطابق — راجع رقم الهيكل مرة أخرى.' },
  check_digit_unverified: { en: 'This VIN does not use the North American check digit, so a typo cannot be ruled out.', ar: 'هذا الرقم لا يستخدم خانة التحقق الأمريكية، فلا يمكن استبعاد خطأ في الكتابة.' },
  unknown_wmi: { en: 'Manufacturer not recognised offline — choose the make manually.', ar: 'لم نتعرّف على الشركة المصنعة دون اتصال — اختر الشركة يدوياً.' },
  make_not_in_catalog: { en: 'Manufacturer recognised but not in the Qitah catalog yet.', ar: 'تعرّفنا على الشركة المصنعة لكنها غير موجودة في كتالوج قطعة بعد.' },
  year_unknown: { en: 'Model year could not be read from the VIN.', ar: 'تعذّرت قراءة سنة الصنع من رقم الهيكل.' },
  year_estimated: { en: 'Model year read from the 10th character; please confirm it.', ar: 'سنة الصنع مقروءة من الخانة العاشرة؛ يرجى تأكيدها.' },
  model_engine_required: { en: 'Model and engine are not decoded offline — choose them next.', ar: 'الطراز والمحرك لا يُستخرجان دون اتصال — اخترهما في الخطوة التالية.' },
};

function finish(d: Omit<VinDecode, 'note' | 'noteAr'>): VinDecode {
  const notes = d.reasons.map((r) => NOTES[r]).filter(Boolean);
  return { ...d, note: notes.map((n) => n.en).join(' '), noteAr: notes.map((n) => n.ar).join(' ') };
}

export function decodeVin(input: string, now = new Date()): VinDecode {
  const vin = normalizeVin(input);
  if (!VIN_RE.test(vin)) return finish({ vin, valid: false, confidence: 'none', reasons: ['invalid_format'] });

  const wmi = vin.slice(0, 3);
  const region = vinRegion(vin);
  const digitOk = vin[8] === vinCheckDigit(vin);
  // The check digit is mandatory for North American VINs only; many other plants fill position 9 freely.
  const checkDigit: VinCheckDigit = digitOk ? 'ok' : region === 'north_america' ? 'mismatch' : 'not_applicable';
  if (checkDigit === 'mismatch') return finish({ vin, valid: false, wmi, region, checkDigit, confidence: 'none', reasons: ['check_digit_failed'] });

  const reasons: string[] = [];
  if (checkDigit === 'not_applicable') reasons.push('check_digit_unverified');
  const entry = WMI_TABLE[wmi];
  if (!entry) reasons.push('unknown_wmi');
  else if (!entry.make) reasons.push('make_not_in_catalog');
  const { year, method } = decodeModelYear(vin, now);
  if (!year) reasons.push('year_unknown');
  else if (method === 'most_recent') reasons.push('year_estimated');
  if (entry?.make) reasons.push('model_engine_required');

  let confidence: VinConfidence;
  if (!entry?.make) confidence = 'low';
  else if (checkDigit === 'ok' && method === 'na_position7') confidence = 'high';
  else if (year) confidence = 'medium';
  else confidence = 'low';

  return finish({
    vin,
    valid: true,
    ...(entry?.make ? { make: entry.make } : {}),
    ...(entry ? { manufacturer: entry.manufacturer } : {}),
    wmi,
    region,
    ...(year ? { modelYear: year } : {}),
    checkDigit,
    confidence,
    reasons,
  });
}
