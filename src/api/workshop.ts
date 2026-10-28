import { api } from './client';

/** "قطعة للورش" (workshop accounts) — server types and endpoints. All money is integer halalas. */

export type OrgRole = 'OWNER' | 'BUYER' | 'TECHNICIAN';
export type OrgStatus = 'APPLIED' | 'APPROVED' | 'REJECTED' | 'SUSPENDED';

export type ApiOrg = {
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
  status: OrgStatus;
  statusReason: string | null;
  approvedAt: string | null;
  createdAt: string;
};

/** Qitah's internal (sandbox) credit line. No external financing partner. */
export type ApiOrgCredit = {
  provider: string;
  sandbox: boolean;
  status: 'ACTIVE' | 'FROZEN' | null;
  limitHalalas: number;
  termsDays: number;
  outstandingHalalas: number;
  availableHalalas: number;
  netTermsEligible: boolean;
};

export type ApiOrgMembership = { org: ApiOrg; role: OrgRole; credit: ApiOrgCredit | null };

export type ApiOrgMember = { id: string; role: OrgRole; status: 'INVITED' | 'ACTIVE' | 'REMOVED'; userId: string | null; name: string | null; phone: string | null; joinedAt: string | null; createdAt: string };

export type ApiStatementOrder = {
  id: string;
  number: string;
  status: string;
  createdAt: string;
  paymentMethod: string;
  totalHalalas: number;
  refundedHalalas: number;
  workOrderRef: string | null;
  workshopQuoteId: string | null;
  buyerName: string | null;
  creditDueAt: string | null;
  outstandingHalalas: number;
  overdue: boolean;
};

export type ApiStatement = {
  org: ApiOrg;
  credit: ApiOrgCredit & { usedHalalas: number; overdueHalalas: number; nextDueAt: string | null };
  totals: { orders: number; spendHalalas: number };
  orders: ApiStatementOrder[];
  repayments: { id: string; amountHalalas: number; reference: string | null; note: string | null; createdAt: string }[];
  members: ApiOrgMember[];
  activity: { id: string; action: string; actorType: string; createdAt: string }[];
};

export type QuoteStatus = 'SENT' | 'APPROVED' | 'DECLINED' | 'EXPIRED' | 'CONVERTED';
export type ApiWorkshopQuote = {
  id: string;
  number: string;
  orgId: string;
  status: QuoteStatus;
  vehicle: { model: string; year?: number; plate?: string; vin?: string };
  lines: { offerId: string; productId: string; nameAr: string; nameEn: string; brand: string; partNumber: string; condition: string; quantity: number; unitPriceHalalas: number; lineTotalHalalas: number }[];
  partsHalalas: number;
  laborHalalas: number;
  markupHalalas: number;
  totalHalalas: number;
  note: string | null;
  customerPhone: string | null;
  expiresAt: string;
  respondedAt: string | null;
  orderId: string | null;
  convertError: string | null;
  createdAt: string;
  /** Only in the create response: the token is never stored in clear on the server. */
  url?: string;
  share?: { text: string; whatsappUrl: string };
};

export type OrgApplication = {
  type?: 'WORKSHOP' | 'FLEET';
  legalName: string;
  displayName: string;
  crNumber: string;
  vatNumber?: string;
  city: string;
  district: string;
  address: string;
  contactPhone: string;
};

export type QuoteInput = {
  addressId: string;
  vehicle: { model: string; year?: number; plate?: string; vin?: string };
  lines: { offerId: string; quantity: number }[];
  laborHalalas: number;
  markupHalalas: number;
  note?: string;
  customerPhone?: string;
};

const auth = { auth: 'required' as const };
const enc = encodeURIComponent;

export const workshopApi = {
  myOrgs: () => api.get<{ orgs: ApiOrgMembership[] }>('/v1/me/orgs', auth),
  apply: (input: OrgApplication) => api.post<{ org: ApiOrg; role: OrgRole }>('/v1/orgs', input, auth),
  get: (orgId: string) => api.get<ApiOrgMembership>(`/v1/orgs/${enc(orgId)}`, auth),
  members: (orgId: string) => api.get<{ members: ApiOrgMember[] }>(`/v1/orgs/${enc(orgId)}/members`, auth),
  invite: (orgId: string, phone: string, role: 'BUYER' | 'TECHNICIAN') => api.post<{ members: ApiOrgMember[] }>(`/v1/orgs/${enc(orgId)}/members`, { phone, role }, auth),
  removeMember: (orgId: string, memberId: string) => api.del<{ members: ApiOrgMember[] }>(`/v1/orgs/${enc(orgId)}/members/${enc(memberId)}`, auth),
  statement: (orgId: string) => api.get<ApiStatement>(`/v1/orgs/${enc(orgId)}/statement`, auth),
  quotes: (orgId: string) => api.get<{ quotes: ApiWorkshopQuote[] }>(`/v1/orgs/${enc(orgId)}/quotes`, auth),
  quote: (orgId: string, id: string) => api.get<ApiWorkshopQuote>(`/v1/orgs/${enc(orgId)}/quotes/${enc(id)}`, auth),
  createQuote: (orgId: string, input: QuoteInput) => api.post<ApiWorkshopQuote>(`/v1/orgs/${enc(orgId)}/quotes`, input, auth),
  convertQuote: (orgId: string, id: string) => api.post<{ orderId: string }>(`/v1/orgs/${enc(orgId)}/quotes/${enc(id)}/convert`, {}, auth),
};
