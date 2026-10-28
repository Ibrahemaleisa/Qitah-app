'use client';

import { SubNav } from './ui';

/** Sub-navigation for "قطعة للورش": organisations, overdue receivables, sales leads. */
export function OrgNav() {
  return (
    <SubNav
      items={[
        { href: '/organizations', label: 'حسابات الورش' },
        { href: '/organizations/receivables', label: 'مستحقات متأخرة', tone: 'danger' },
        { href: '/organizations/leads', label: 'ورش محتملة' },
      ]}
    />
  );
}

export type OrgCredit = {
  provider: string;
  sandbox: boolean;
  status: 'ACTIVE' | 'FROZEN' | null;
  limitHalalas: number;
  termsDays: number;
  outstandingHalalas: number;
  availableHalalas: number;
  netTermsEligible: boolean;
};

export type OrgRow = {
  id: string;
  type: 'WORKSHOP' | 'FLEET';
  legalName: string;
  displayName: string;
  crNumber: string;
  vatNumber: string | null;
  city: string;
  district: string;
  address: string;
  contactPhone: string;
  status: string;
  statusReason: string | null;
  approvedAt: string | null;
  createdAt: string;
};
