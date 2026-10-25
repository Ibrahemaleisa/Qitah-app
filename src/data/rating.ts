import type { RatingSummary } from '@/domain/types';

/** Builds a plausible star distribution for SAMPLE ratings from an average and count. */
export function sampleRating(average: number, count: number, verifiedShare = 0.85): RatingSummary {
  const weights = [5, 4, 3, 2, 1].map((star) => Math.exp(-Math.abs(star - average) * 1.6));
  const total = weights.reduce((a, b) => a + b, 0);
  const counts = weights.map((w) => Math.round((w / total) * count));
  const drift = count - counts.reduce((a, b) => a + b, 0);
  counts[0] += drift;
  return {
    average,
    count,
    verifiedShare,
    distribution: counts as RatingSummary['distribution'],
  };
}
