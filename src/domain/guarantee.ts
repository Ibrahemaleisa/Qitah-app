import { getFitStatus, type FitStatus } from './compatibility';
import type { Product, Vehicle } from './types';

/**
 * Fit guarantee ("ضمان قطعة") — client-side eligibility, used only to show the badge.
 *
 * The server re-computes fit at checkout from the customer's garage vehicle and stores it on each
 * order line; that snapshot (not this function) decides whether a "wrong part" return is covered.
 * The rules mirror the server: catalog-verified fitment for the selected vehicle, or a part that
 * fits by specification. Seller-reported fitment is never guaranteed.
 */
export function isGuaranteedFit(status: FitStatus): boolean {
  return status === 'catalogMatch' || status === 'bySpecification';
}

export type GuaranteeState =
  /** Covered for the selected vehicle (or by specification). */
  | 'covered'
  /** Would be covered, but no vehicle is selected yet. */
  | 'needsVehicle'
  /** Not covered: seller-reported or no fitment data for this vehicle. */
  | 'notCovered';

export function guaranteeState(product: Product, vehicle: Vehicle | undefined): GuaranteeState {
  const status = getFitStatus(product, vehicle);
  if (isGuaranteedFit(status)) return 'covered';
  if (status === 'noVehicle') return product.fitment.some((f) => f.source === 'catalog') ? 'needsVehicle' : 'notCovered';
  return 'notCovered';
}

/** Who pays return shipping, by reason — the same table the server applies. */
export type ReturnPayer = 'qitah' | 'seller' | 'customer';

export function returnShippingPayer(reason: 'wrongPart' | 'damaged' | 'notAsDescribed' | 'changedMind', guaranteed: boolean, sellerClaimedFit = false): ReturnPayer {
  if (reason === 'wrongPart') return guaranteed ? 'qitah' : sellerClaimedFit ? 'seller' : 'customer';
  if (reason === 'changedMind') return 'customer';
  return 'seller';
}
