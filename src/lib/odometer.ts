/** Parses "45,000" / "٤٥٬٠٠٠" into kilometres; undefined when it is not a plausible reading. */
export function parseKm(input: string): number | undefined {
  const digits = input.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[\s,٬.]/g, '');
  if (!/^\d{1,7}$/.test(digits)) return undefined;
  const n = Number(digits);
  return n <= 3_000_000 ? n : undefined;
}

/** 45000 → "45,000" (kilometres never show decimals). */
export function formatKm(km: number): string {
  return Math.round(km)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
