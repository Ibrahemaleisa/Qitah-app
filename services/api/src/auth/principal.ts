import type { FastifyRequest } from 'fastify';
import type { MerchantRole, PlatformRole } from '@prisma/client';

import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import type { TokenService } from './tokens.js';

export type Principal = {
  userId: string;
  platformRoles: PlatformRole[];
  memberships: { merchantId: string; role: MerchantRole }[];
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
  }
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Account unavailable');
  const [roles, memberships] = await Promise.all([
    prisma.platformRoleAssignment.findMany({ where: { userId: user.id } }),
    prisma.merchantMember.findMany({ where: { userId: user.id, status: 'ACTIVE' } }),
  ]);
  return {
    userId: user.id,
    platformRoles: roles.map((r) => r.role),
    memberships: memberships.map((m) => ({ merchantId: m.merchantId, role: m.role })),
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

  return { principal, requireUser, requirePlatform, requireMerchant };
}

export type Guards = ReturnType<typeof createGuards>;
