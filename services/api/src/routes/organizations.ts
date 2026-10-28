import type { Prisma } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { cityId, halalas, pageQuery, parse, rateLimit, saudiPhone } from '../lib/http.js';
import type { Actor } from '../services/events.js';
import * as orgs from '../services/organizations.js';
import * as quotes from '../services/workshopQuotes.js';

const idParam = z.object({ id: z.string().min(1).max(64) });

const applyBody = z.object({
  type: z.enum(['WORKSHOP', 'FLEET']).default('WORKSHOP'),
  legalName: z.string().trim().min(2).max(120),
  displayName: z.string().trim().min(2).max(80),
  // Saudi commercial registration: 10 digits.
  crNumber: z.string().trim().regex(/^\d{10}$/, 'CR number must be 10 digits'),
  vatNumber: z.string().trim().regex(/^3\d{13}3$/, 'VAT number must be 15 digits starting and ending with 3').optional(),
  city: cityId,
  district: z.string().trim().min(2).max(80),
  address: z.string().trim().min(2).max(200),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  contactPhone: saudiPhone,
});

const quoteBody = z.object({
  addressId: z.string().min(1).max(64),
  vehicle: z.object({
    model: z.string().trim().min(2).max(80),
    year: z.number().int().min(1980).max(2035).optional(),
    plate: z.string().trim().max(20).optional(),
    vin: z.string().trim().regex(/^[A-HJ-NPR-Z0-9]{17}$/i).optional(),
  }),
  lines: z.array(z.object({ offerId: z.string().max(64), quantity: z.number().int().min(1).max(20) })).min(1).max(30),
  laborHalalas: halalas.max(10_000_000).default(0),
  markupHalalas: halalas.max(10_000_000).default(0),
  note: z.string().max(500).optional(),
  customerPhone: saudiPhone.optional(),
});

/** Workshop / fleet member endpoints (/v1/orgs/**, /v1/me/orgs). */
export async function organizationRoutes(app: FastifyInstance, deps: Deps) {
  const { requireUser, requireOrg } = deps.guards;
  const { ctx } = deps;

  /** Apply for a workshop account. The applicant becomes its OWNER; ops reviews the CR. */
  app.post('/v1/orgs', rateLimit(ctx.config.RATE_LIMIT_SCALE, 5, '10 minutes'), async (req) => {
    const p = await requireUser(req);
    const body = parse(applyBody, req.body);
    const org = await orgs.applyOrganization(p.userId, body);
    return { org: orgs.presentOrg(org), role: 'OWNER' };
  });

  /** The user's organisations (links pending phone invites first). Drives the app's org switcher. */
  app.get('/v1/me/orgs', async (req) => {
    const p = await requireUser(req);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: p.userId }, select: { phone: true } });
    await orgs.linkPendingInvites(p.userId, user.phone);
    const rows = await prisma.organizationMember.findMany({ where: { userId: p.userId, status: 'ACTIVE' }, include: { org: true }, orderBy: { createdAt: 'asc' } });
    const out = [];
    for (const m of rows) {
      const canBuy = m.role !== 'TECHNICIAN';
      out.push({ org: orgs.presentOrg(m.org), role: m.role, credit: canBuy ? await orgs.creditState(prisma, m.orgId) : null });
    }
    return { orgs: out };
  });

  app.get('/v1/orgs/:id', async (req) => {
    const { id } = parse(idParam, req.params);
    const { role } = await requireOrg(req, id);
    const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
    return { org: orgs.presentOrg(org), role, credit: role === 'TECHNICIAN' ? null : await orgs.creditState(prisma, id) };
  });

  app.get('/v1/orgs/:id/members', async (req) => {
    const { id } = parse(idParam, req.params);
    await requireOrg(req, id);
    return { members: await orgs.listMembers(id) };
  });

  app.post('/v1/orgs/:id/members', rateLimit(ctx.config.RATE_LIMIT_SCALE, 30, '10 minutes'), async (req) => {
    const { id } = parse(idParam, req.params);
    const { principal } = await requireOrg(req, id, 'OWNER');
    const body = parse(z.object({ phone: saudiPhone, role: z.enum(['BUYER', 'TECHNICIAN']) }), req.body);
    await orgs.inviteMember(principal.userId, id, body.phone, body.role);
    return { members: await orgs.listMembers(id) };
  });

  app.delete('/v1/orgs/:id/members/:memberId', async (req) => {
    const { id, memberId } = parse(z.object({ id: z.string().max(64), memberId: z.string().max(64) }), req.params);
    const { principal } = await requireOrg(req, id, 'OWNER');
    await orgs.removeMember(principal.userId, id, memberId);
    return { members: await orgs.listMembers(id) };
  });

  /** Statement: orders, credit used/available, repayments and due dates, members, activity. Money → BUYER+. */
  app.get('/v1/orgs/:id/statement', async (req) => {
    const { id } = parse(idParam, req.params);
    await requireOrg(req, id, 'BUYER');
    return orgs.orgStatement(id);
  });

  // ── workshop → customer quotes
  app.post('/v1/orgs/:id/quotes', rateLimit(ctx.config.RATE_LIMIT_SCALE, 30, '10 minutes'), async (req) => {
    const { id } = parse(idParam, req.params);
    const { principal } = await requireOrg(req, id, 'BUYER');
    const body = parse(quoteBody, req.body);
    return quotes.createWorkshopQuote(principal.userId, id, body, ctx.config.PUBLIC_BASE_URL);
  });

  app.get('/v1/orgs/:id/quotes', async (req) => {
    const { id } = parse(idParam, req.params);
    await requireOrg(req, id, 'BUYER');
    return { quotes: await quotes.listWorkshopQuotes(id) };
  });

  app.get('/v1/orgs/:id/quotes/:quoteId', async (req) => {
    const { id, quoteId } = parse(z.object({ id: z.string().max(64), quoteId: z.string().max(64) }), req.params);
    await requireOrg(req, id, 'BUYER');
    return quotes.getWorkshopQuote(id, quoteId);
  });

  /** Retry turning an APPROVED quote into a workshop order (e.g. after restocking or a credit change). */
  app.post('/v1/orgs/:id/quotes/:quoteId/convert', async (req) => {
    const { id, quoteId } = parse(z.object({ id: z.string().max(64), quoteId: z.string().max(64) }), req.params);
    await requireOrg(req, id, 'BUYER');
    const q = await prisma.workshopQuote.findFirst({ where: { id: quoteId, orgId: id } });
    if (!q) throw notFound('Quote');
    return quotes.convertWorkshopQuote(ctx, q.id);
  });
}

/** Qitah operations: /v1/ops/organizations/**, receivables, workshop leads (BFF allowlist: v1/ops/**). */
export async function organizationOpsRoutes(app: FastifyInstance, deps: Deps) {
  const { requirePlatform } = deps.guards;
  const ops = async (req: Parameters<typeof requirePlatform>[0], roles?: Parameters<typeof requirePlatform>[1]) => {
    const p = await requirePlatform(req, roles);
    return { p, actor: { userId: p.userId, type: 'ops' } as Actor };
  };

  app.get('/v1/ops/organizations', async (req) => {
    await ops(req);
    const q = parse(pageQuery.extend({ status: z.enum(['APPLIED', 'APPROVED', 'REJECTED', 'SUSPENDED']).optional(), q: z.string().max(100).optional() }), req.query);
    const where: Prisma.OrganizationWhereInput = {
      ...(q.status ? { status: q.status } : {}),
      ...(q.q ? { OR: [{ displayName: { contains: q.q, mode: 'insensitive' } }, { legalName: { contains: q.q, mode: 'insensitive' } }, { crNumber: { contains: q.q } }] } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.organization.count({ where }),
      prisma.organization.findMany({ where, include: { credit: true, _count: { select: { members: true, orders: true } } }, orderBy: { createdAt: 'desc' }, take: q.limit, skip: q.offset }),
    ]);
    const items = [];
    for (const o of rows) {
      items.push({ ...orgs.presentOrg(o), members: o._count.members, orders: o._count.orders, credit: o.credit ? await orgs.creditState(prisma, o.id) : null });
    }
    return { total, items };
  });

  app.get('/v1/ops/organizations/:id', async (req) => {
    await ops(req);
    const { id } = parse(idParam, req.params);
    const org = await prisma.organization.findUnique({ where: { id } });
    if (!org) throw notFound('Organization');
    const statement = await orgs.orgStatement(id);
    const creditRow = await prisma.organizationCredit.findUnique({ where: { orgId: id } });
    return { ...statement, creditLine: creditRow };
  });

  for (const decision of ['approve', 'reject', 'suspend', 'reinstate'] as const) {
    app.post(`/v1/ops/organizations/:id/${decision}`, async (req) => {
      const { actor } = await ops(req, ['OPS_ADMIN']);
      const { id } = parse(idParam, req.params);
      const body = parse(z.object({ reason: z.string().max(500).optional() }), req.body ?? {});
      return orgs.presentOrg(await orgs.decideOrganization(actor, id, decision, body.reason));
    });
  }

  /** Set the limit / terms, or freeze / unfreeze (status). Qitah internal sandbox credit only. */
  app.put('/v1/ops/organizations/:id/credit', async (req) => {
    const { actor } = await ops(req, ['OPS_ADMIN', 'FINANCE']);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ limitHalalas: halalas.optional(), termsDays: z.number().int().min(0).max(180).optional(), status: z.enum(['ACTIVE', 'FROZEN']).optional() }).refine((b) => Object.keys(b).length > 0, 'Nothing to update'),
      req.body,
    );
    await orgs.setCredit(actor, id, body);
    return orgs.creditState(prisma, id);
  });

  /** A repayment received outside Qitah (bank transfer). Idempotent on (org, idempotencyKey). */
  app.post('/v1/ops/organizations/:id/repayments', async (req) => {
    const { actor } = await ops(req, ['FINANCE']);
    const { id } = parse(idParam, req.params);
    const body = parse(
      z.object({ amountHalalas: z.number().int().positive().max(100_000_000), idempotencyKey: z.string().min(8).max(100), reference: z.string().max(120).optional(), note: z.string().max(300).optional() }),
      req.body,
    );
    const repayment = await orgs.recordRepayment(actor, id, body);
    return { repayment, credit: await orgs.creditState(prisma, id) };
  });

  app.get('/v1/ops/receivables/overdue', async (req) => {
    await ops(req, ['FINANCE', 'OPS_AGENT']);
    return orgs.overdueReceivables();
  });

  app.get('/v1/ops/workshop-leads', async (req) => {
    await ops(req);
    return { items: await orgs.workshopLeads() };
  });
}
