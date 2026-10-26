/** Arabic UI, Gregorian calendar, Western digits, Riyadh time (UTC+3, no DST). */
const LOCALE = 'ar-SA-u-ca-gregory-nu-latn';
export const TZ = 'Asia/Riyadh';

const dtf = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const df = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, year: 'numeric', month: 'short', day: 'numeric' });
const tf = new Intl.DateTimeFormat(LOCALE, { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : dtf.format(d);
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : df.format(d);
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : tf.format(d);
}

/** "منذ 5 د" / "منذ 3 س" / date. */
export function formatAgo(iso: string, now = Date.now()): string {
  const diff = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (diff < 1) return 'الآن';
  if (diff < 60) return `منذ ${diff} د`;
  if (diff < 24 * 60) return `منذ ${Math.floor(diff / 60)} س`;
  return formatDate(iso);
}

/** Minutes → "2س 05د" style compact duration (absolute value). */
export function formatMinutes(mins: number): string {
  const a = Math.abs(mins);
  if (a < 60) return `${a} د`;
  const h = Math.floor(a / 60);
  if (h < 48) return `${h}س ${String(a % 60).padStart(2, '0')}د`;
  return `${Math.floor(h / 24)} يوم`;
}

export function formatWeight(grams: number): string {
  return `${(grams / 1000).toFixed(1)} كجم`;
}

export const CITIES: Record<string, string> = {
  riyadh: 'الرياض',
  jeddah: 'جدة',
  makkah: 'مكة المكرمة',
  madinah: 'المدينة المنورة',
  dammam: 'الدمام',
  khobar: 'الخبر',
};
export const cityName = (id: string | null | undefined) => (id ? (CITIES[id] ?? id) : '—');

/** Riyadh wall-clock date (YYYY-MM-DD) for a Date. */
export function riyadhDate(d = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

/** Riyadh wall-clock hour (0-23). */
export function riyadhHour(d = new Date()): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hour12: false }).format(d)) % 24;
}

/** "2026-10-26" + "14:00" in Riyadh → ISO instant. Riyadh is fixed UTC+03:00. */
export function riyadhToIso(date: string, time: string): string {
  return new Date(`${date}T${time}:00+03:00`).toISOString();
}

export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00+03:00`);
  d.setUTCDate(d.getUTCDate() + days);
  return riyadhDate(d);
}

export const shortId = (id: string | null | undefined) => (id ? `…${id.slice(-6)}` : '—');
