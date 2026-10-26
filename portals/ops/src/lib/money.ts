/**
 * Money is integer halalas (1 SAR = 100 halalas). Never use floats for money:
 * formatting uses integer division and parsing uses string math.
 */

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** 12345 → "123.45" (Western digits, thousands separators). */
export function formatSarAmount(halalas: number): string {
  if (!Number.isSafeInteger(halalas)) return '—';
  const sign = halalas < 0 ? '-' : '';
  const abs = Math.abs(halalas);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  return `${sign}${group(String(whole))}.${String(frac).padStart(2, '0')}`;
}

/** 12345 → "123.45 ر.س" */
export function formatSar(halalas: number): string {
  return `${formatSarAmount(halalas)} ر.س`;
}

const ARABIC_INDIC = /[٠-٩۰-۹]/g;

/** Normalises Arabic-Indic digits and Arabic decimal/thousands separators to ASCII. */
export function normalizeDigits(input: string): string {
  return input
    .replace(ARABIC_INDIC, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/[٫]/g, '.') // Arabic decimal separator
    .replace(/[٬،,\s]/g, ''); // Arabic thousands separator, Arabic comma, comma, spaces
}

/**
 * Parses a typed SAR amount into halalas using string math only.
 * Accepts "12", "12.5", "12.50", "1,234.50", "١٢٫٥". Returns null for anything else
 * (negative, more than 2 decimals, empty, non-numeric, or beyond 1,000,000 SAR).
 */
export function parseSarToHalalas(input: string): number | null {
  const s = normalizeDigits(input.trim());
  const m = /^(\d{1,7})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = m[1];
  const frac = (m[2] ?? '').padEnd(2, '0');
  const halalas = Number(whole) * 100 + Number(frac);
  if (!Number.isSafeInteger(halalas) || halalas > 100_000_000) return null;
  return halalas;
}
