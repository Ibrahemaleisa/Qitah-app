import type { SellerGroup } from '@/domain/pricing';

export type CheckoutBlocker = 'emptyCart' | 'signIn' | 'address' | 'workshopUnsupported' | 'paymentIneligible';

/** Everything that currently prevents placing the order, in the order the customer should fix it. */
export function checkoutBlockers(input: {
  cartCount: number;
  signedIn: boolean;
  hasAddress: boolean;
  groups: SellerGroup[];
  paymentEligible: boolean;
}): CheckoutBlocker[] {
  const blockers: CheckoutBlocker[] = [];
  if (input.cartCount === 0) blockers.push('emptyCart');
  if (!input.signedIn) blockers.push('signIn');
  if (!input.hasAddress) blockers.push('address');
  if (input.groups.some((g) => g.deliveryOptions.length === 0)) blockers.push('workshopUnsupported');
  if (!input.paymentEligible) blockers.push('paymentIneligible');
  return blockers;
}
