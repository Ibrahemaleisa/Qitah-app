import { canBuyForOrg, canSeeMoney, netTermsState, normalizeSaudiMobile, normalizeWorkOrderRef, quoteTotals, sarInputToHalalas, type WorkshopMembership } from '@/domain/workshop';

const member = (patch: Partial<WorkshopMembership> = {}): WorkshopMembership => ({
  role: 'BUYER',
  org: { status: 'APPROVED' },
  credit: { netTermsEligible: true, availableHalalas: 100_000, status: 'ACTIVE' },
  ...patch,
});

describe('workshop mode rules', () => {
  it('only BUYER/OWNER of an approved org can buy; technicians never see money', () => {
    expect(canBuyForOrg(member())).toBe(true);
    expect(canBuyForOrg(member({ role: 'OWNER' }))).toBe(true);
    expect(canBuyForOrg(member({ role: 'TECHNICIAN' }))).toBe(false);
    expect(canBuyForOrg(member({ org: { status: 'APPLIED' } }))).toBe(false);
    expect(canBuyForOrg(member({ org: { status: 'SUSPENDED' } }))).toBe(false);
    expect(canBuyForOrg(undefined)).toBe(false);
    expect(canSeeMoney(member({ role: 'TECHNICIAN' }))).toBe(false);
  });

  it('offers net terms only within the available credit', () => {
    expect(netTermsState(member(), 50_000)).toBe('available');
    expect(netTermsState(member(), 100_000)).toBe('available');
    expect(netTermsState(member(), 100_001)).toBe('overLimit');
    expect(netTermsState(member(), undefined)).toBe('overLimit');
    expect(netTermsState(member({ credit: { netTermsEligible: false, availableHalalas: 100_000, status: 'FROZEN' } }), 10)).toBe('frozen');
    expect(netTermsState(member({ credit: null }), 10)).toBe('none');
    expect(netTermsState(member({ role: 'TECHNICIAN' }), 10)).toBe('none');
  });

  it('normalises inputs', () => {
    expect(normalizeWorkOrderRef('  JOB-12   أ ب ج  ')).toBe('JOB-12 أ ب ج');
    expect(normalizeWorkOrderRef('   ')).toBeUndefined();
    expect(normalizeWorkOrderRef('x'.repeat(80))).toHaveLength(60);
    expect(sarInputToHalalas('150')).toBe(15000);
    expect(sarInputToHalalas('150.5')).toBe(15050);
    expect(sarInputToHalalas('١٥٠٫٢٥')).toBe(15025);
    expect(sarInputToHalalas('')).toBe(0);
    expect(sarInputToHalalas('1.234')).toBeNull();
    expect(sarInputToHalalas('-5')).toBeNull();
    expect(normalizeSaudiMobile('0512345678')).toBe('+966512345678');
    expect(normalizeSaudiMobile('٠٥١٢٣٤٥٦٧٨')).toBe('+966512345678');
    expect(normalizeSaudiMobile('+966512345678')).toBe('+966512345678');
    expect(normalizeSaudiMobile('0112345678')).toBeNull();
  });

  it('computes quote totals in integer halalas', () => {
    expect(quoteTotals([{ unitPriceHalalas: 12_345, quantity: 2 }, { unitPriceHalalas: 99, quantity: 1 }], 15_000, 5_000)).toEqual({
      partsHalalas: 24_789,
      laborHalalas: 15_000,
      markupHalalas: 5_000,
      totalHalalas: 44_789,
    });
  });
});
