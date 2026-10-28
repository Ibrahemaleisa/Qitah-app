/**
 * "وضع الورشة" (workshop mode) rules shared by the screens. Pure functions, no I/O.
 * The server re-checks every one of them; these only decide what the app offers.
 */

export type WorkshopRole = 'OWNER' | 'BUYER' | 'TECHNICIAN';
export type WorkshopMembership = {
  role: WorkshopRole;
  org: { status: 'APPLIED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' };
  credit: { netTermsEligible: boolean; availableHalalas: number; status: 'ACTIVE' | 'FROZEN' | null } | null;
};

/** BUYER/OWNER of an APPROVED org may place orders for it. */
export function canBuyForOrg(m: WorkshopMembership | undefined): boolean {
  return !!m && m.role !== 'TECHNICIAN' && m.org.status === 'APPROVED';
}

/** OWNER/BUYER see money (statement, credit, quotes). */
export function canSeeMoney(m: WorkshopMembership | undefined): boolean {
  return !!m && m.role !== 'TECHNICIAN';
}

export type NetTermsState = 'available' | 'overLimit' | 'frozen' | 'none';

/** Whether "الدفع الآجل" can be offered for an order of `totalHalalas`. */
export function netTermsState(m: WorkshopMembership | undefined, totalHalalas: number | undefined): NetTermsState {
  if (!canBuyForOrg(m) || !m!.credit || m!.credit.status === null) return 'none';
  if (m!.credit.status === 'FROZEN') return 'frozen';
  if (totalHalalas === undefined || totalHalalas > m!.credit.availableHalalas) return 'overLimit';
  return 'available';
}

/** Work-order / plate reference: trimmed, at most 60 characters, empty → undefined. */
export function normalizeWorkOrderRef(raw: string): string | undefined {
  const v = raw.replace(/\s+/g, ' ').trim().slice(0, 60);
  return v || undefined;
}

/** Customer total of a workshop quote, all integer halalas. */
export function quoteTotals(lines: { unitPriceHalalas: number; quantity: number }[], laborHalalas: number, markupHalalas: number) {
  const partsHalalas = lines.reduce((s, l) => s + l.unitPriceHalalas * l.quantity, 0);
  return { partsHalalas, laborHalalas, markupHalalas, totalHalalas: partsHalalas + laborHalalas + markupHalalas };
}

/** "150" / "150.5" / "١٥٠" (SAR typed by the workshop) → halalas; invalid → null. */
export function sarInputToHalalas(raw: string): number | null {
  const s = raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[٫,]/g, '.').trim();
  if (!s) return 0;
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(s)) return null;
  const [int, dec = ''] = s.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}

/** Saudi mobile as typed (05XXXXXXXX, 9665…, +9665…) → +9665XXXXXXXX, else null. */
export function normalizeSaudiMobile(raw: string): string | null {
  const s = raw.replace(/[\s\-()]/g, '').replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
  if (/^05\d{8}$/.test(s)) return `+966${s.slice(1)}`;
  if (/^9665\d{8}$/.test(s)) return `+${s}`;
  if (/^\+9665\d{8}$/.test(s)) return s;
  return null;
}
