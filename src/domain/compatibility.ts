import type { Fitment, Product, Vehicle } from './types';

/**
 * Fit status is deliberately conservative. Only catalog-backed fitment is reported as a match;
 * seller-reported fitment is surfaced as unverified, and nothing is ever inferred.
 */
export type FitStatus =
  | 'catalogMatch'
  | 'sellerReported'
  | 'bySpecification'
  | 'noData'
  | 'noVehicle';

function fitmentApplies(f: Fitment, vehicle: Vehicle): boolean {
  if (f.modelId !== vehicle.modelId) return false;
  if (vehicle.year < f.yearFrom || vehicle.year > f.yearTo) return false;
  if (f.engines && !f.engines.includes(vehicle.engine)) return false;
  return true;
}

export function getFitStatus(product: Product, vehicle: Vehicle | undefined): FitStatus {
  if (product.universal) return 'bySpecification';
  if (!vehicle) return 'noVehicle';
  const matches = product.fitment.filter((f) => fitmentApplies(f, vehicle));
  if (matches.some((f) => f.source === 'catalog')) return 'catalogMatch';
  if (matches.some((f) => f.source === 'seller')) return 'sellerReported';
  return 'noData';
}

/** Lower is more relevant to the selected vehicle. */
export function fitRank(status: FitStatus): number {
  switch (status) {
    case 'catalogMatch':
      return 0;
    case 'sellerReported':
      return 1;
    case 'bySpecification':
      return 2;
    case 'noVehicle':
      return 2;
    case 'noData':
      return 3;
  }
}
