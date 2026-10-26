/** All money is integer halalas (1 SAR = 100 halalas). No floating point arithmetic on money. */

export const VAT_BPS = 1500;

function assertInt(n: number, label: string) {
  if (!Number.isSafeInteger(n)) throw new Error(`${label} must be a safe integer (halalas), got ${n}`);
}

/** VAT portion of a VAT-inclusive amount: amount * 15 / 115, rounded half-up. */
export function vatOfInclusive(amount: number): number {
  assertInt(amount, 'amount');
  return Math.floor((amount * VAT_BPS + (10000 + VAT_BPS) / 2) / (10000 + VAT_BPS));
}

/** amount * bps / 10000 rounded half-up, integer only. */
export function applyBps(amount: number, bps: number): number {
  assertInt(amount, 'amount');
  assertInt(bps, 'bps');
  return Math.floor((amount * bps + 5000) / 10000);
}

export function sum(values: number[]): number {
  return values.reduce((a, b) => {
    assertInt(b, 'value');
    return a + b;
  }, 0);
}

/** Split `total` across weights proportionally with the largest-remainder method (sums exactly). */
export function allocate(total: number, weights: number[]): number[] {
  assertInt(total, 'total');
  const w = sum(weights);
  if (w === 0) return weights.map((_, i) => (i === 0 ? total : 0));
  const raw = weights.map((x) => (total * x) / w);
  const base = raw.map(Math.floor);
  let rest = total - sum(base);
  const order = raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    base[i]++;
    rest--;
  }
  return base;
}

export const formatSar = (h: number) => `${(h / 100).toFixed(2)} SAR`;
