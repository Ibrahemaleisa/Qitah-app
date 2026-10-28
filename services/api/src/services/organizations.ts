import { Prisma, type Organization, type OrganizationRole, type OrganizationStatus } from '@prisma/client';

import { prisma, withTx, type Db, type Tx } from '../db.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit, emit, notify, type Actor } from './events.js';
import { post } from './ledger.js';

/**
 * "قطعة للورش": workshop / fleet organisations.
 *
 * - Any signed-in user can apply (CR number required) and becomes its OWNER. Ops approves or rejects.
 * - The OWNER invites BUYER / TECHNICIAN members by phone; the invite is linked when that phone signs in (OTP).
 * - Credit: Qitah's INTERNAL sandbox credit line (`OrganizationCredit.provider = 'qitah-internal-sandbox'`), no
 *   financing partner. Outstanding = the org's CUSTOMER_RECEIVABLE ledger balance (the ledger is the truth).
 * - Repayments are recorded by finance and allocated to the oldest-due credit orders first.
 */

export const CREDIT_PROVIDER_LABEL = 'qitah-internal-sandbox';
export const NET_TERMS = 'NET_TERMS';

/** OWNER > BUYER > TECHNICIAN. */
export const ORG_ROLE_RANK: Record<OrganizationRole, number> = { OWNER: 3, BUYER: 2, TECHNICIAN: 1 };

// ───────────────────────────── membership & onboarding

export type ApplyInput = {
  type: 'WORKSHOP' | 'FLEET';
  legalName: string;
  displayName: string;
  crNumber: string;
  vatNumber?: string;
  city: string;
  district: string;
  address: string;
  latitude?: number;
  longitude?: number;
  contactPhone: string;
};

export async function applyOrganization(userId: string, input: ApplyInput) {
  return withTx(async (tx) => {
    const taken = await tx.organization.findFirst({ where: { crNumber: input.crNumber, status: { in: ['APPLIED', 'APPROVED', 'SUSPENDED'] } } });
    if (taken) throw conflict('CR_ALREADY_REGISTERED', 'An organisation with this CR number is already registered or under review');
    const org = await tx.organization.create({ data: { ...input, createdById: userId, members: { create: { userId, role: 'OWNER', status: 'ACTIVE', joinedAt: new Date() } } } });
    await audit(tx, { userId, type: 'customer' }, { action: 'organization.applied', entityType: 'organization', entityId: org.id, data: { crNumber: org.crNumber, type: org.type } });
    await notify(tx, { audience: 'OPS', type: 'organization.applied', title: 'طلب حساب ورشة جديد', body: `${org.displayName} — س.ت ${org.crNumber}`, data: { orgId: org.id } });
    return org;
  });
}

const ORG_TRANSITIONS: Record<'approve' | 'reject' | 'suspend' | 'reinstate', { to: OrganizationStatus; from: OrganizationStatus[] }> = {
  approve: { to: 'APPROVED', from: ['APPLIED'] },
  reject: { to: 'REJECTED', from: ['APPLIED'] },
  suspend: { to: 'SUSPENDED', from: ['APPROVED'] },
  reinstate: { to: 'APPROVED', from: ['SUSPENDED'] },
};
export type OrgDecision = keyof typeof ORG_TRANSITIONS;

export async function decideOrganization(actor: Actor, orgId: string, decision: OrgDecision, reason?: string) {
  const t = ORG_TRANSITIONS[decision];
  if ((t.to === 'REJECTED' || t.to === 'SUSPENDED') && !reason) throw badRequest('REASON_REQUIRED', 'A reason is required');
  return withTx(async (tx) => {
    const rows = await tx.$queryRaw<{ status: OrganizationStatus }[]>`SELECT status FROM "Organization" WHERE id = ${orgId} FOR UPDATE`;
    if (!rows.length) throw notFound('Organization');
    if (!t.from.includes(rows[0].status)) throw conflict('INVALID_TRANSITION', `Organization is ${rows[0].status}`);
    const org = await tx.organization.update({
      where: { id: orgId },
      data: { status: t.to, statusReason: reason ?? null, ...(decision === 'approve' ? { approvedAt: new Date(), approvedById: actor.userId } : {}) },
    });
    const owners = await tx.organizationMember.findMany({ where: { orgId, role: 'OWNER', status: 'ACTIVE', userId: { not: null } } });
    const title = { approve: 'تم اعتماد حساب الورشة', reject: 'لم يتم اعتماد حساب الورشة', suspend: 'تم إيقاف حساب الورشة مؤقتاً', reinstate: 'تمت إعادة تفعيل حساب الورشة' }[decision];
    for (const o of owners) {
      await notify(tx, { audience: 'CUSTOMER', userId: o.userId!, type: `organization.${decision}`, title, body: reason ?? org.displayName, data: { orgId } });
    }
    await audit(tx, actor, { action: `organization.${decision}`, entityType: 'organization', entityId: orgId, data: { reason: reason ?? null } });
    await emit(tx, { type: 'organization.updated', entityType: 'organization', entityId: orgId, payload: { status: t.to } });
    return org;
  });
}

/** Saudi mobile in +9665XXXXXXXX form. */
export async function inviteMember(actorUserId: string, orgId: string, phone: string, role: Exclude<OrganizationRole, 'OWNER'>) {
  return withTx(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org) throw notFound('Organization');
    if (org.status === 'REJECTED' || org.status === 'SUSPENDED') throw conflict('ORG_NOT_ACTIVE', `Organization is ${org.status}`);
    const user = await tx.user.findUnique({ where: { phone } });
    const existing = await tx.organizationMember.findFirst({ where: { orgId, OR: [{ invitedPhone: phone }, ...(user ? [{ userId: user.id }] : [])] } });
    if (existing?.status === 'ACTIVE') throw conflict('ALREADY_MEMBER', 'This phone is already a member');
    if (existing?.role === 'OWNER') throw conflict('ALREADY_MEMBER', 'This phone is the owner');
    const member = existing
      ? await tx.organizationMember.update({ where: { id: existing.id }, data: { role, status: 'INVITED', invitedPhone: phone, invitedById: actorUserId } })
      : await tx.organizationMember.create({ data: { orgId, invitedPhone: phone, role, status: 'INVITED', invitedById: actorUserId } });
    await audit(tx, { userId: actorUserId, type: 'customer' }, { action: 'organization.member_invited', entityType: 'organization', entityId: orgId, data: { memberId: member.id, role, phone: maskPhone(phone) } });
    return member;
  });
}

export async function removeMember(actorUserId: string, orgId: string, memberId: string) {
  return withTx(async (tx) => {
    const m = await tx.organizationMember.findFirst({ where: { id: memberId, orgId } });
    if (!m) throw notFound('Member');
    if (m.role === 'OWNER') throw conflict('OWNER_REQUIRED', 'The owner cannot be removed');
    const updated = await tx.organizationMember.update({ where: { id: m.id }, data: { status: 'REMOVED' } });
    await audit(tx, { userId: actorUserId, type: 'customer' }, { action: 'organization.member_removed', entityType: 'organization', entityId: orgId, data: { memberId } });
    return updated;
  });
}

/**
 * Links pending phone invites to the user who just proved that phone (OTP sign-in, or the first Cognito sign-in).
 * Idempotent; called again on GET /v1/me/orgs for sessions that were already signed in when invited.
 */
export async function linkPendingInvites(userId: string, phone: string | null | undefined) {
  if (!phone) return 0;
  const invites = await prisma.organizationMember.findMany({ where: { invitedPhone: phone, status: 'INVITED' } });
  let linked = 0;
  for (const inv of invites) {
    if (inv.userId && inv.userId !== userId) continue;
    try {
      const r = await prisma.organizationMember.updateMany({ where: { id: inv.id, status: 'INVITED' }, data: { userId, status: 'ACTIVE', joinedAt: new Date() } });
      if (r.count) {
        linked++;
        await audit(prisma, { userId, type: 'customer' }, { action: 'organization.member_joined', entityType: 'organization', entityId: inv.orgId, data: { memberId: inv.id, role: inv.role } });
      }
    } catch (e) {
      // Already a member of this org through another row (unique orgId+userId): leave the stale invite.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
  return linked;
}

export const maskPhone = (phone: string | null | undefined) => (phone ? `${phone.slice(0, 6)}•••${phone.slice(-2)}` : null);

// ───────────────────────────── credit

/** The org's NET_TERMS receivable (what it owes Qitah), from the ledger. */
export async function outstandingHalalas(db: Db, orgId: string) {
  const r = await db.ledgerEntry.aggregate({ where: { account: 'CUSTOMER_RECEIVABLE', order: { buyerOrgId: orgId } }, _sum: { amountHalalas: true } });
  return r._sum.amountHalalas ?? 0;
}

export async function creditState(db: Db, orgId: string) {
  const [org, credit, outstanding] = await Promise.all([
    db.organization.findUnique({ where: { id: orgId }, select: { status: true } }),
    db.organizationCredit.findUnique({ where: { orgId } }),
    outstandingHalalas(db, orgId),
  ]);
  const available = credit ? Math.max(0, credit.limitHalalas - outstanding) : 0;
  return {
    provider: credit?.provider ?? CREDIT_PROVIDER_LABEL,
    /** Always true for now: no financing partner is connected; Qitah's internal ledger carries the exposure. */
    sandbox: true,
    status: credit?.status ?? null,
    limitHalalas: credit?.limitHalalas ?? 0,
    termsDays: credit?.termsDays ?? 30,
    outstandingHalalas: outstanding,
    availableHalalas: available,
    netTermsEligible: org?.status === 'APPROVED' && credit?.status === 'ACTIVE' && available > 0,
  };
}

export async function setCredit(actor: Actor, orgId: string, input: { limitHalalas?: number; termsDays?: number; status?: 'ACTIVE' | 'FROZEN' }) {
  return withTx(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org) throw notFound('Organization');
    if (input.status === 'ACTIVE' && org.status !== 'APPROVED') throw conflict('ORG_NOT_APPROVED', 'Approve the organisation before activating credit');
    const existing = await tx.organizationCredit.findUnique({ where: { orgId } });
    if (!existing && input.limitHalalas === undefined) throw badRequest('LIMIT_REQUIRED', 'Set a credit limit first');
    const credit = existing
      ? await tx.organizationCredit.update({ where: { orgId }, data: { ...input, approvedById: actor.userId } })
      : await tx.organizationCredit.create({ data: { orgId, limitHalalas: input.limitHalalas!, termsDays: input.termsDays ?? 30, status: input.status ?? 'ACTIVE', approvedById: actor.userId } });
    await audit(tx, actor, { action: 'organization.credit_set', entityType: 'organization', entityId: orgId, data: { limitHalalas: credit.limitHalalas, termsDays: credit.termsDays, status: credit.status } });
    return credit;
  });
}

/**
 * Who may buy for an org: an ACTIVE BUYER/OWNER of an APPROVED org. Checked from the database (not the token)
 * because quote conversion places orders on the workshop's behalf without a request principal.
 */
export async function assertCanBuyFor(db: Db, userId: string, orgId: string): Promise<Organization> {
  const m = await db.organizationMember.findFirst({ where: { orgId, userId, status: 'ACTIVE' }, include: { org: true } });
  if (!m || ORG_ROLE_RANK[m.role] < ORG_ROLE_RANK.BUYER) throw forbidden('No buying access to this organisation');
  if (m.org.status !== 'APPROVED') throw conflict('ORG_NOT_APPROVED', `Organization is ${m.org.status}`);
  return m.org;
}

/**
 * NET_TERMS authorisation inside the checkout transaction. Locks the credit row FOR UPDATE first, so parallel
 * checkouts of the same org serialise: the second one sees the first one's receivable once it commits.
 */
export async function authorizeNetTerms(tx: Tx, orgId: string, totalHalalas: number) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "OrganizationCredit" WHERE "orgId" = ${orgId} FOR UPDATE`;
  if (!rows.length) throw conflict('NO_CREDIT_LINE', 'This organisation has no credit line');
  const credit = await tx.organizationCredit.findUniqueOrThrow({ where: { orgId } });
  if (credit.status !== 'ACTIVE') throw conflict('CREDIT_FROZEN', 'Net terms are frozen for this organisation');
  const outstanding = await outstandingHalalas(tx, orgId);
  if (outstanding + totalHalalas > credit.limitHalalas) {
    throw conflict('CREDIT_LIMIT_EXCEEDED', 'This order exceeds the available credit', { availableHalalas: Math.max(0, credit.limitHalalas - outstanding), totalHalalas });
  }
  return credit;
}

// ───────────────────────────── repayments

type Allocation = { orderId: string; amountHalalas: number }[];

/** Per-order receivable balances of an org (positive = still owed), oldest due first. */
async function openReceivables(db: Db, orgId: string) {
  const sums = await db.ledgerEntry.groupBy({ by: ['orderId'], where: { account: 'CUSTOMER_RECEIVABLE', order: { buyerOrgId: orgId } }, _sum: { amountHalalas: true } });
  const ids = sums.filter((s) => s.orderId && (s._sum.amountHalalas ?? 0) !== 0).map((s) => s.orderId!);
  const orders = await db.order.findMany({ where: { id: { in: ids } }, select: { id: true, number: true, creditDueAt: true, paidAt: true, createdAt: true, workOrderRef: true, totalHalalas: true } });
  return orders
    .map((o) => ({ ...o, balanceHalalas: sums.find((s) => s.orderId === o.id)?._sum.amountHalalas ?? 0 }))
    .sort((a, b) => (a.creditDueAt?.getTime() ?? 0) - (b.creditDueAt?.getTime() ?? 0) || a.createdAt.getTime() - b.createdAt.getTime());
}

export async function recordRepayment(actor: Actor, orgId: string, input: { amountHalalas: number; idempotencyKey: string; reference?: string; note?: string }) {
  const key = `${orgId}:${input.idempotencyKey}`;
  return withTx(async (tx) => {
    const org = await tx.organization.findUnique({ where: { id: orgId } });
    if (!org) throw notFound('Organization');
    // Same lock as NET_TERMS checkout: repayments and new credit orders of one org never interleave.
    await tx.$queryRaw`SELECT id FROM "OrganizationCredit" WHERE "orgId" = ${orgId} FOR UPDATE`;
    const existing = await tx.organizationRepayment.findUnique({ where: { idempotencyKey: key } });
    if (existing) return existing;
    const open = await openReceivables(tx, orgId);
    const outstanding = open.reduce((s, o) => s + o.balanceHalalas, 0);
    if (input.amountHalalas > outstanding) throw conflict('REPAYMENT_EXCEEDS_OUTSTANDING', `At most ${outstanding} halalas are outstanding`, { outstandingHalalas: outstanding });
    const allocation: Allocation = [];
    let rest = input.amountHalalas;
    for (const o of open) {
      if (rest <= 0) break;
      if (o.balanceHalalas <= 0) continue;
      const a = Math.min(rest, o.balanceHalalas);
      allocation.push({ orderId: o.id, amountHalalas: a });
      rest -= a;
    }
    const repayment = await tx.organizationRepayment.create({
      data: { orgId, amountHalalas: input.amountHalalas, idempotencyKey: key, reference: input.reference, note: input.note, allocation, recordedById: actor.userId },
    });
    for (const a of allocation) {
      // Cash received from the workshop (clearing, debit) settles what it owed on that order (receivable, credit).
      await post(tx, {
        type: 'CREDIT_REPAYMENT',
        refType: 'org_repayment',
        refId: `${repayment.id}:${a.orderId}`,
        orderId: a.orderId,
        lines: [
          { account: 'CUSTOMER_CLEARING', amountHalalas: a.amountHalalas },
          { account: 'CUSTOMER_RECEIVABLE', amountHalalas: -a.amountHalalas },
        ],
      });
    }
    await audit(tx, actor, { action: 'organization.repayment_recorded', entityType: 'organization', entityId: orgId, data: { repaymentId: repayment.id, amount: input.amountHalalas, reference: input.reference ?? null } });
    const owners = await tx.organizationMember.findMany({ where: { orgId, role: 'OWNER', status: 'ACTIVE', userId: { not: null } } });
    for (const o of owners) {
      await notify(tx, { audience: 'CUSTOMER', userId: o.userId!, type: 'organization.repayment', title: 'تم تسجيل سداد', body: `${(input.amountHalalas / 100).toFixed(2)} ر.س — ${org.displayName}`, data: { orgId } });
    }
    return repayment;
  });
}

/** Sum of repayments allocated to one order (used by reconciliation). */
export async function repaidForOrder(db: Db, orgId: string, orderId: string) {
  const reps = await db.organizationRepayment.findMany({ where: { orgId }, select: { allocation: true } });
  return reps.flatMap((r) => r.allocation as Allocation).filter((a) => a.orderId === orderId).reduce((s, a) => s + a.amountHalalas, 0);
}

// ───────────────────────────── statement & ops views

export function presentOrg(o: Organization) {
  return {
    id: o.id,
    type: o.type,
    legalName: o.legalName,
    displayName: o.displayName,
    crNumber: o.crNumber,
    vatNumber: o.vatNumber,
    city: o.city,
    district: o.district,
    address: o.address,
    latitude: o.latitude,
    longitude: o.longitude,
    contactPhone: o.contactPhone,
    status: o.status,
    statusReason: o.statusReason,
    approvedAt: o.approvedAt?.toISOString() ?? null,
    createdAt: o.createdAt.toISOString(),
  };
}

export async function listMembers(orgId: string) {
  const rows = await prisma.organizationMember.findMany({ where: { orgId, status: { not: 'REMOVED' } }, orderBy: { createdAt: 'asc' } });
  const users = await prisma.user.findMany({ where: { id: { in: rows.flatMap((r) => (r.userId ? [r.userId] : [])) } }, select: { id: true, name: true, phone: true } });
  return rows.map((r) => {
    const u = users.find((x) => x.id === r.userId);
    return { id: r.id, role: r.role, status: r.status, userId: r.userId, name: u?.name ?? null, phone: u?.phone ?? r.invitedPhone, joinedAt: r.joinedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() };
  });
}

/** GET /v1/orgs/:id/statement — orders, credit used/available, repayments, due dates, members and activity. */
export async function orgStatement(orgId: string, now = new Date()) {
  const org = await prisma.organization.findUnique({ where: { id: orgId } });
  if (!org) throw notFound('Organization');
  const [credit, orders, receivableByOrder, repayments, members, activity] = await Promise.all([
    creditState(prisma, orgId),
    prisma.order.findMany({ where: { buyerOrgId: orgId }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.ledgerEntry.groupBy({ by: ['orderId'], where: { account: 'CUSTOMER_RECEIVABLE', order: { buyerOrgId: orgId } }, _sum: { amountHalalas: true } }),
    prisma.organizationRepayment.findMany({ where: { orgId }, orderBy: { createdAt: 'desc' }, take: 50 }),
    listMembers(orgId),
    prisma.auditEvent.findMany({ where: { entityType: 'organization', entityId: orgId }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ]);
  const buyers = await prisma.user.findMany({ where: { id: { in: [...new Set(orders.map((o) => o.customerId))] } }, select: { id: true, name: true } });
  const owed = (id: string) => receivableByOrder.find((r) => r.orderId === id)?._sum.amountHalalas ?? 0;
  const presented = orders.map((o) => {
    const outstanding = owed(o.id);
    return {
      id: o.id,
      number: o.number,
      status: o.status,
      createdAt: o.createdAt.toISOString(),
      paymentMethod: o.paymentMethod,
      totalHalalas: o.totalHalalas,
      refundedHalalas: o.refundedHalalas,
      workOrderRef: o.workOrderRef,
      workshopQuoteId: o.workshopQuoteId,
      buyerName: buyers.find((b) => b.id === o.customerId)?.name ?? null,
      creditDueAt: o.creditDueAt?.toISOString() ?? null,
      outstandingHalalas: outstanding,
      overdue: outstanding > 0 && !!o.creditDueAt && o.creditDueAt < now,
    };
  });
  const overdueHalalas = presented.filter((o) => o.overdue).reduce((s, o) => s + o.outstandingHalalas, 0);
  const nextDue = presented.filter((o) => o.outstandingHalalas > 0 && o.creditDueAt).map((o) => o.creditDueAt!).sort()[0] ?? null;
  return {
    org: presentOrg(org),
    credit: { ...credit, usedHalalas: credit.outstandingHalalas, overdueHalalas, nextDueAt: nextDue },
    totals: {
      orders: presented.length,
      spendHalalas: presented.filter((o) => !['PENDING_PAYMENT', 'EXPIRED', 'CANCELLED', 'PAYMENT_FAILED'].includes(o.status)).reduce((s, o) => s + o.totalHalalas - o.refundedHalalas, 0),
    },
    orders: presented,
    repayments: repayments.map((r) => ({ id: r.id, amountHalalas: r.amountHalalas, reference: r.reference, note: r.note, createdAt: r.createdAt.toISOString(), allocation: r.allocation })),
    members,
    activity: activity.map((a) => ({ id: a.id, action: a.action, actorType: a.actorType, createdAt: a.createdAt.toISOString(), data: a.data })),
  };
}

/** Ops: every credit order with an outstanding balance past its due date. */
export async function overdueReceivables(now = new Date()) {
  const sums = await prisma.ledgerEntry.groupBy({ by: ['orderId'], where: { account: 'CUSTOMER_RECEIVABLE', orderId: { not: null } }, _sum: { amountHalalas: true } });
  const owed = sums.filter((s) => (s._sum.amountHalalas ?? 0) > 0);
  const orders = await prisma.order.findMany({
    where: { id: { in: owed.map((s) => s.orderId!) }, creditDueAt: { lt: now } },
    include: { buyerOrg: { select: { id: true, displayName: true, contactPhone: true } } },
    orderBy: { creditDueAt: 'asc' },
  });
  const items = orders.map((o) => ({
    orderId: o.id,
    number: o.number,
    org: o.buyerOrg,
    workOrderRef: o.workOrderRef,
    totalHalalas: o.totalHalalas,
    outstandingHalalas: owed.find((s) => s.orderId === o.id)!._sum.amountHalalas ?? 0,
    creditDueAt: o.creditDueAt!.toISOString(),
    daysOverdue: Math.floor((now.getTime() - o.creditDueAt!.getTime()) / 86_400_000),
  }));
  const byOrg = new Map<string, { orgId: string; displayName: string; outstandingHalalas: number; orders: number }>();
  for (const i of items) {
    if (!i.org) continue;
    const row = byOrg.get(i.org.id) ?? { orgId: i.org.id, displayName: i.org.displayName, outstandingHalalas: 0, orders: 0 };
    row.outstandingHalalas += i.outstandingHalalas;
    row.orders++;
    byOrg.set(i.org.id, row);
  }
  return { totalHalalas: items.reduce((s, i) => s + i.outstandingHalalas, 0), byOrg: [...byOrg.values()], items };
}

/**
 * Sales leads: workshops that mechanics named on "send to my mechanic" reviews, grouped by phone, with
 * whether that phone already belongs to an organisation member.
 */
export async function workshopLeads(limit = 200) {
  const rows = await prisma.mechanicReview.groupBy({
    by: ['workshopPhone'],
    where: { workshopPhone: { not: null } },
    _count: { _all: true },
    _max: { respondedAt: true },
    orderBy: { _max: { respondedAt: 'desc' } },
    take: limit,
  });
  const phones = rows.map((r) => r.workshopPhone!);
  const [names, users] = await Promise.all([
    prisma.mechanicReview.findMany({ where: { workshopPhone: { in: phones }, workshopName: { not: null } }, select: { workshopPhone: true, workshopName: true, respondedAt: true }, orderBy: { respondedAt: 'desc' } }),
    prisma.user.findMany({ where: { phone: { in: phones } }, select: { id: true, phone: true } }),
  ]);
  const members = await prisma.organizationMember.findMany({ where: { OR: [{ userId: { in: users.map((u) => u.id) } }, { invitedPhone: { in: phones } }], status: { not: 'REMOVED' } }, include: { org: { select: { id: true, displayName: true, status: true } } } });
  return rows.map((r) => {
    const phone = r.workshopPhone!;
    const userId = users.find((u) => u.phone === phone)?.id;
    const m = members.find((x) => x.invitedPhone === phone || (userId && x.userId === userId));
    return {
      phone,
      workshopName: names.find((n) => n.workshopPhone === phone)?.workshopName ?? null,
      reviews: r._count._all,
      lastSeenAt: r._max.respondedAt?.toISOString() ?? null,
      organization: m ? { id: m.org.id, displayName: m.org.displayName, status: m.org.status } : null,
    };
  });
}
