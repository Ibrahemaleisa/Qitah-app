import { groupCartBySeller } from '@/domain/pricing';
import { checkoutBlockers } from '@/services/checkout';

const homeGroups = groupCartBySeller([{ offerId: 'o-001', qty: 1 }], 'home', 'riyadh');

describe('checkoutBlockers', () => {
  it('is empty when everything is in place', () => {
    expect(checkoutBlockers({ cartCount: 1, signedIn: true, hasAddress: true, groups: homeGroups, paymentEligible: true })).toEqual([]);
  });

  it('lists every reason in fix order', () => {
    expect(checkoutBlockers({ cartCount: 1, signedIn: false, hasAddress: false, groups: homeGroups, paymentEligible: false })).toEqual(['signIn', 'address', 'paymentIneligible']);
  });

  it('flags sellers that cannot deliver to a workshop', () => {
    const workshop = groupCartBySeller([{ offerId: 'o-008', qty: 1 }], 'workshop', 'riyadh');
    expect(checkoutBlockers({ cartCount: 1, signedIn: true, hasAddress: true, groups: workshop, paymentEligible: true })).toEqual(['workshopUnsupported']);
  });
});
