import type { FastifyRequest } from 'fastify';
import type { MerchantRole, OrganizationRole, OrganizationStatus, PlatformRole } from '@prisma/client';

import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { linkPendingInvites, ORG_ROLE_RANK } from '../services/organizations.js';
import type { TokenService } from './tokens.js';

export type OrgMembership = { orgId: string; role: OrganizationRole; orgStatus: OrganizationStatus };

export type Principal = {
  userId: string;
  platformRoles: PlatformRole[];
  memberships: { merchantId: string; role: MerchantRole }[];
  /** ACTIVE workshop/fleet memberships (any org status; callers check APPROVED where it matters). */
  orgMemberships: OrgMembership[];
};


declare module 'fastify' {
  interface FastifyRequest {
    principalPromise?: Promise<Principal | null>;
  }
}

async function resolve(req: FastifyRequest, tokens: TokenService): Promise<Principal | null> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return null;
  let verified;
  try {
    verified = await tokens.verify(header.slice(7));
  } catch {
    throw unauthorized('Invalid or expired token');
  }
  let user =
    verified.issuer === 'local'
      ? await prisma.user.findUnique({ where: { id: verified.subject } })
      : await prisma.user.findUnique({ where: { cognitoSub: verified.subject } });
  if (!user && verified.issuer === 'cognito') {
    // First sign-in through Cognito: link to an existing (invited/seeded) user by verified email/phone, else create.
    const existing = verified.email
      ? await prisma.user.findUnique({ where: { email: verified.email } })
      : verified.phone
        ? await prisma.user.findUnique({ where: { phone: verified.phone } })
        : null;
    user = existing
      ? await prisma.user.update({ where: { id: existing.id }, data: { cognitoSub: verified.subject } })
      : await prisma.user.create({ data: { cognitoSub: verified.subject, email: verified.email, phone: verified.phone } });
    // Cognito verified this phone: link workshop invites sent to it (same as the local OTP sign-in).
    if (verified.phone) await linkPendingInvites(user.id, verified.phone);
  }
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Account unavailable');
  const [roles, memberships, orgMemberships] = await Promise.all([
    prisma.platformRoleAssignment.findMany({ where: { userId: user.id } }),
    prisma.merchantMember.findMany({ where: { userId: user.id, status: 'ACTIVE' } }),
    prisma.organizationMember.findMany({ where: { userId: user.id, status: 'ACTIVE' }, include: { org: { select: { status: true } } } }),
  ]);
  return {
    userId: user.id,
    platformRoles: roles.map((r) => r.role),
    memberships: memberships.map((m) => ({ merchantId: m.merchantId, role: m.role })),
    orgMemberships: orgMemberships.map((m) => ({ orgId: m.orgId, role: m.role, orgStatus: m.org.status })),
  };
}

export function createGuards(tokens: TokenService) {
  function principal(req: FastifyRequest) {
    req.principalPromise ??= resolve(req, tokens);
    return req.principalPromise;
  }

  async function requireUser(req: FastifyRequest): Promise<Principal> {
    const p = await principal(req);
    if (!p) throw unauthorized();
    return p;
  }

  /** Internal Qitah staff. OPS_ADMIN implies every platform role. */
  async function requirePlatform(req: FastifyRequest, roles: PlatformRole[] = ['OPS_AGENT', 'OPS_ADMIN', 'FINANCE']) {
    const p = await requireUser(req);
    if (!p.platformRoles.some((r) => r === 'OPS_ADMIN' || roles.includes(r))) throw forbidden('Qitah operations access required');
    return p;
  }

  /** Merchant staff of exactly this merchant. Roles are ordered OWNER > MANAGER > STAFF. */
  async function requireMerchant(req: FastifyRequest, merchantId: string, minRole: MerchantRole = 'STAFF') {
    const p = await requireUser(req);
    const m = p.memberships.find((x) => x.merchantId === merchantId);
    const rank: Record<MerchantRole, number> = { OWNER: 3, MANAGER: 2, STAFF: 1 };
    // Same response for "not a member" and "no such merchant" to avoid leaking merchant existence.
    if (!m || rank[m.role] < rank[minRole]) throw forbidden('No access to this merchant');
    return { principal: p, role: m.role };
  }

  /**
   * Active member of exactly this workshop/fleet organisation with at least `minRole`.
   * Same 403 for "not a member", "role too low" and "no such org" so org ids cannot be probed.
   */
  async function requireOrg(req: FastifyRequest, orgId: string, minRole: OrganizationRole = 'TECHNICIAN') {
    const p = await requireUser(req);
    const m = p.orgMemberships.find((x) => x.orgId === orgId);
    if (!m || ORG_ROLE_RANK[m.role] < ORG_ROLE_RANK[minRole]) throw forbidden('No access to this organisation');
    return { principal: p, role: m.role, orgStatus: m.orgStatus };
  }

  return { principal, requireUser, requirePlatform, requireMerchant, requireOrg };
}

export type Guards = ReturnType<typeof createGuards>;
