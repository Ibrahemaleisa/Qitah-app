/**
 * Money at the API boundary. The API speaks integer halalas (1 SAR = 100 halalas); the app's
 * existing domain types and `Price` component use SAR numbers. Convert ONLY for display/domain
 * mapping — never add up converted floats to produce a total the customer pays. Checkout and order
 * totals are always the server's halala figures converted once.
 */

export function halalasToSar(halalas: number | null | undefined): number {
  if (halalas == null || !Number.isFinite(halalas)) return 0;
  // Integer halalas → SAR with exactly two decimals, avoiding float drift (e.g. 1999 → 19.99).
  return Math.round(halalas) / 100;
}

export function sarToHalalas(sar: number): number {
  return Math.round(sar * 100);
}

/** Optional variant: keeps `null`/`undefined` (e.g. no compare-at price). */
export function optionalHalalasToSar(halalas: number | null | undefined): number | undefined {
  return halalas == null ? undefined : halalasToSar(halalas);
}
