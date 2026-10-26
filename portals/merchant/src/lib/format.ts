/** Formatting helpers. Western digits everywhere, Gregorian calendar, Riyadh time. */

const sarFormatter = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const intFormatter = new Intl.NumberFormat("en-US");

/** 12345 → "123.45 ر.س" */
export function formatSar(halalas: number | null | undefined): string {
  if (halalas === null || halalas === undefined || !Number.isFinite(halalas)) return "—";
  return `${sarFormatter.format(halalas / 100)} ر.س`;
}

/** 12345 → "123.45" (for prefilling inputs) */
export function halalasToInput(halalas: number | null | undefined): string {
  if (halalas === null || halalas === undefined) return "";
  const sign = halalas < 0 ? "-" : "";
  const abs = Math.abs(halalas);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function formatInt(n: number | null | undefined): string {
  return n === null || n === undefined ? "—" : intFormatter.format(n);
}

/** Converts Arabic-Indic / Persian digits to Western digits so typed numbers always parse. */
export function toWesternDigits(value: string): string {
  return value
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".") // Arabic decimal separator
    .replace(/٬/g, ","); // Arabic thousands separator
}

/**
 * Parses a SAR amount typed by a person into integer halalas by string parsing — never floating
 * point. "12.5" → 1250, "12" → 1200, "1,250.75" → 125075. Returns null when invalid.
 */
export function parseSarToHalalas(input: string): number | null {
  const cleaned = toWesternDigits(input).trim().replace(/,/g, "");
  const m = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}

/** Whole number ≥ 0 from user input, or null. */
export function parseWhole(input: string): number | null {
  const cleaned = toWesternDigits(input).trim();
  if (!/^\d{1,9}$/.test(cleaned)) return null;
  return Number(cleaned);
}

const TZ = "Asia/Riyadh";
const dateTimeFormatter = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", {
  timeZone: TZ,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: TZ, year: "numeric", month: "short", day: "numeric" });
const timeFormatter = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: TZ, hour: "2-digit", minute: "2-digit" });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateTimeFormatter.format(new Date(iso));
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return dateFormatter.format(new Date(iso));
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return timeFormatter.format(new Date(iso));
}

/** "متبقٍ 2 س 15 د" / "متأخر 40 د" relative to now. */
export function formatDue(iso: string, now: number): { text: string; overdue: boolean; soon: boolean } {
  const diffMin = Math.round((new Date(iso).getTime() - now) / 60_000);
  const abs = Math.abs(diffMin);
  const days = Math.floor(abs / 1440);
  const hours = Math.floor((abs % 1440) / 60);
  const mins = abs % 60;
  const parts = days ? `${days} ي ${hours} س` : hours ? `${hours} س ${mins} د` : `${mins} د`;
  if (diffMin < 0) return { text: `متأخر ${parts}`, overdue: true, soon: false };
  return { text: `متبقٍ ${parts}`, overdue: false, soon: diffMin <= 60 };
}

/** "+966512345678" from "0512345678", "512345678", "+966 51 234 5678"… or null when not a Saudi mobile. */
export function normalizeSaudiMobile(input: string): string | null {
  const digits = toWesternDigits(input).replace(/[\s-]/g, "");
  const m = /^(?:\+?966|0)?(5\d{8})$/.exec(digits);
  return m ? `+966${m[1]}` : null;
}

export function percent(ratio: number | null | undefined): string {
  if (ratio === null || ratio === undefined) return "—";
  return `${(ratio * 100).toFixed(1)}%`;
}
