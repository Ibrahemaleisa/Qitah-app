import type { Prisma } from '@prisma/client';

import { prisma, withTx } from '../db.js';
import { badRequest, notFound } from '../lib/errors.js';
import {
  computeServiceStatus,
  GENERIC_MAINTENANCE_TEMPLATES,
  MAINTENANCE_DISCLAIMER,
  matchesComponent,
  templatesForVehicle,
  type KitComponent,
  type MaintenanceTemplateData,
  type ServiceCode,
  type ServiceVariant,
} from '../lib/maintenance.js';
import { publicOfferWhere } from './catalog.js';
import { notify } from './events.js';

/** Active templates from the database; the built-in generic guidance when none are configured. */
export async function loadTemplates(): Promise<MaintenanceTemplateData[]> {
  const rows = await prisma.maintenanceTemplate.findMany({ where: { active: true }, orderBy: { sort: 'asc' } });
  if (!rows.length) return GENERIC_MAINTENANCE_TEMPLATES;
  return rows.map((r) => ({
    id: r.id,
    serviceCode: r.serviceCode as ServiceCode,
    makeId: r.makeId,
    modelId: r.modelId,
    nameAr: r.nameAr,
    nameEn: r.nameEn,
    noteAr: r.noteAr,
    noteEn: r.noteEn,
    intervalKm: r.intervalKm,
    intervalMonths: r.intervalMonths,
    variants: (r.variants as unknown as ServiceVariant[]) ?? [],
    components: (r.components as unknown as KitComponent[]) ?? [],
    sort: r.sort,
  }));
}

type VehicleRow = Prisma.GarageVehicleGetPayload<{ include: { model: true } }>;

async function ownedVehicle(userId: string, vehicleId: string): Promise<VehicleRow> {
  const v = await prisma.garageVehicle.findFirst({ where: { id: vehicleId, userId, deletedAt: null }, include: { model: true } });
  if (!v) throw notFound('Vehicle');
  return v;
}

type LatestRecord = { id: string; serviceCode: string; doneAtKm: number | null; doneAt: Date; variant: string | null; source: string };

async function latestRecords(vehicleIds: string[]): Promise<Map<string, LatestRecord>> {
  const rows = await prisma.vehicleServiceRecord.findMany({
    where: { vehicleId: { in: vehicleIds } },
    orderBy: [{ vehicleId: 'asc' }, { serviceCode: 'asc' }, { doneAt: 'desc' }, { createdAt: 'desc' }],
    distinct: ['vehicleId', 'serviceCode'],
  });
  return new Map(rows.map((r) => [`${r.vehicleId}:${r.serviceCode}`, r]));
}

// ── kits

export type KitLine = {
  componentKey: string;
  component: { ar: string; en: string };
  productId: string;
  offerId: string;
  name: { ar: string; en: string };
  brand: string;
  partNumber: string;
  priceHalalas: number;
  available: number;
  quantity: number;
  /** catalog = catalog-verified fitment for this vehicle; universal = fits by specification. */
  fit: 'catalog' | 'universal';
};

const kitProductInclude = {
  fitments: true,
  offers: { where: publicOfferWhere, include: { inventory: true } },
} satisfies Prisma.ProductInclude;
type KitProduct = Prisma.ProductGetPayload<{ include: typeof kitProductInclude }>;

async function kitCandidates(templates: MaintenanceTemplateData[]): Promise<KitProduct[]> {
  const categoryIds = [...new Set(templates.flatMap((t) => t.components.flatMap((c) => c.categoryIds)))];
  if (!categoryIds.length) return [];
  return prisma.product.findMany({
    where: { status: 'ACTIVE', categoryId: { in: categoryIds }, offers: { some: publicOfferWhere } },
    include: kitProductInclude,
    orderBy: { id: 'asc' },
  });
}

function vehicleFit(p: KitProduct, v: { modelId: string; year: number; engine: string }): 'catalog' | 'universal' | null {
  const catalog = p.fitments.some(
    (f) => f.source === 'CATALOG' && f.modelId === v.modelId && v.year >= f.yearFrom && v.year <= f.yearTo && (f.engines.length === 0 || f.engines.includes(v.engine)),
  );
  if (catalog) return 'catalog';
  if (p.universalNoteAr) return 'universal';
  // Seller-reported or no fitment data never goes into a kit.
  return null;
}

/**
 * A kit = one compatible, in-stock offer per component. Catalog-verified fitment beats universal
 * (by-specification) parts; ties go to the lowest price.
 */
export function composeKit(template: MaintenanceTemplateData, products: KitProduct[], v: { modelId: string; year: number; engine: string }) {
  const lines: KitLine[] = [];
  const missing: { key: string; name: { ar: string; en: string } }[] = [];
  for (const c of template.components) {
    const options = products
      .filter((p) => matchesComponent(p, c))
      .map((p) => {
        const fit = vehicleFit(p, v);
        const offer = p.offers
          .map((o) => ({ o, available: o.inventory ? Math.max(0, o.inventory.onHand - o.inventory.reserved) : 0 }))
          .filter((x) => x.available > 0)
          .sort((a, b) => a.o.priceHalalas - b.o.priceHalalas || a.o.id.localeCompare(b.o.id))[0];
        return fit && offer ? { p, fit, offer } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => (a.fit === b.fit ? 0 : a.fit === 'catalog' ? -1 : 1) || a.offer.o.priceHalalas - b.offer.o.priceHalalas || a.p.id.localeCompare(b.p.id));
    const best = options[0];
    if (!best) {
      missing.push({ key: c.key, name: { ar: c.nameAr, en: c.nameEn } });
      continue;
    }
    lines.push({
      componentKey: c.key,
      component: { ar: c.nameAr, en: c.nameEn },
      productId: best.p.id,
      offerId: best.offer.o.id,
      name: { ar: best.p.nameAr, en: best.p.nameEn },
      brand: best.p.brand,
      partNumber: best.p.partNumber,
      priceHalalas: best.offer.o.priceHalalas,
      available: best.offer.available,
      quantity: 1,
      fit: best.fit,
    });
  }
  return { lines, missing, totalHalalas: lines.reduce((s, l) => s + l.priceHalalas * l.quantity, 0) };
}

// ── proposals from delivered orders

async function orderProposals(userId: string, vehicle: VehicleRow, templates: MaintenanceTemplateData[], vehicleCount: number, now: Date) {
  const since = new Date(now.getTime() - 180 * 86_400_000);
  const items = await prisma.orderItem.findMany({
    where: { status: 'ACTIVE', order: { customerId: userId }, merchantOrder: { status: 'DELIVERED', deliveredAt: { gte: since } } },
    include: { order: { select: { vehicleSnapshot: true } }, merchantOrder: { select: { deliveredAt: true } } },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  if (!items.length) return [];
  const recorded = new Set(
    (await prisma.vehicleServiceRecord.findMany({ where: { vehicle: { userId }, orderItemId: { in: items.map((i) => i.id) } }, select: { orderItemId: true } })).map((r) => r.orderItemId),
  );
  const products = new Map(
    (await prisma.product.findMany({ where: { id: { in: [...new Set(items.map((i) => i.productId))] } }, select: { id: true, categoryId: true, keywords: true, nameAr: true, nameEn: true } })).map((p) => [p.id, p]),
  );
  const out: { orderItemId: string; serviceCode: string; service: { ar: string; en: string }; product: { ar: string; en: string }; deliveredAt: string | null }[] = [];
  for (const item of items) {
    if (recorded.has(item.id)) continue;
    const snap = (item.order.vehicleSnapshot ?? null) as { modelId?: string; year?: number } | null;
    const forThisVehicle = snap?.modelId ? snap.modelId === vehicle.modelId && (!snap.year || snap.year === vehicle.year) : vehicleCount === 1;
    if (!forThisVehicle) continue;
    const p = products.get(item.productId);
    if (!p) continue;
    const t = templates.find((tpl) => tpl.components.some((c) => c.primary && matchesComponent(p, c)));
    if (!t || out.some((o) => o.serviceCode === t.serviceCode)) continue;
    out.push({
      orderItemId: item.id,
      serviceCode: t.serviceCode,
      service: { ar: t.nameAr, en: t.nameEn },
      product: { ar: item.productNameAr, en: item.productNameEn },
      deliveredAt: item.merchantOrder.deliveredAt?.toISOString() ?? null,
    });
  }
  return out;
}

// ── read model

export async function vehicleMaintenance(userId: string, vehicleId: string, now = new Date()) {
  const vehicle = await ownedVehicle(userId, vehicleId);
  const templates = templatesForVehicle(await loadTemplates(), { makeId: vehicle.model.makeId, modelId: vehicle.modelId });
  const [records, products, vehicleCount] = await Promise.all([
    latestRecords([vehicle.id]),
    kitCandidates(templates),
    prisma.garageVehicle.count({ where: { userId, deletedAt: null } }),
  ]);
  const services = templates.map((t) => {
    const last = records.get(`${vehicle.id}:${t.serviceCode}`) ?? null;
    const st = computeServiceStatus({ intervalKm: t.intervalKm, intervalMonths: t.intervalMonths, variants: t.variants, odometerKm: vehicle.odometerKm, last, now });
    return {
      serviceCode: t.serviceCode,
      templateId: t.id,
      name: { ar: t.nameAr, en: t.nameEn },
      note: { ar: t.noteAr, en: t.noteEn },
      intervalKm: st.intervalKm,
      intervalMonths: t.intervalMonths ?? null,
      variants: t.variants.map((v) => ({ code: v.code, name: { ar: v.nameAr, en: v.nameEn }, intervalKm: v.intervalKm })),
      status: st.status,
      nextDueKm: st.nextDueKm,
      nextDueAt: st.nextDueAt,
      remainingKm: st.remainingKm,
      remainingDays: st.remainingDays,
      lastRecord: last ? { id: last.id, doneAtKm: last.doneAtKm, doneAt: last.doneAt.toISOString(), variant: last.variant, source: last.source } : null,
      kit: composeKit(t, products, vehicle),
    };
  });
  return {
    vehicle: { id: vehicle.id, modelId: vehicle.modelId, year: vehicle.year, engine: vehicle.engine, odometerKm: vehicle.odometerKm, odometerUpdatedAt: vehicle.odometerUpdatedAt?.toISOString() ?? null },
    disclaimer: MAINTENANCE_DISCLAIMER,
    services,
    proposals: await orderProposals(userId, vehicle, templates, vehicleCount, now),
  };
}

// ── writes

export async function recordService(
  userId: string,
  vehicleId: string,
  input: { serviceCode: string; doneAtKm?: number; doneAt?: string; variant?: string; orderItemId?: string },
  now = new Date(),
) {
  const vehicle = await ownedVehicle(userId, vehicleId);
  const templates = templatesForVehicle(await loadTemplates(), { makeId: vehicle.model.makeId, modelId: vehicle.modelId });
  const t = templates.find((x) => x.serviceCode === input.serviceCode);
  if (!t) throw badRequest('UNKNOWN_SERVICE', 'Unknown service code');
  if (input.variant && !t.variants.some((v) => v.code === input.variant)) throw badRequest('UNKNOWN_VARIANT', 'Unknown variant for this service');
  const doneAt = input.doneAt ? new Date(input.doneAt) : now;
  if (Number.isNaN(doneAt.getTime()) || doneAt.getTime() > now.getTime() + 86_400_000 || doneAt.getUTCFullYear() < 1990) throw badRequest('INVALID_DATE', 'Service date must be in the past');

  let source: 'MANUAL' | 'ORDER' = 'MANUAL';
  if (input.orderItemId) {
    const item = await prisma.orderItem.findFirst({
      where: { id: input.orderItemId, status: 'ACTIVE', order: { customerId: userId }, merchantOrder: { status: 'DELIVERED' } },
    });
    if (!item) throw notFound('Delivered order line');
    const p = await prisma.product.findUniqueOrThrow({ where: { id: item.productId }, select: { categoryId: true, keywords: true, nameAr: true, nameEn: true } });
    if (!t.components.some((c) => c.primary && matchesComponent(p, c))) throw badRequest('ORDER_LINE_MISMATCH', 'This order line does not match the service');
    source = 'ORDER';
  }

  return withTx(async (tx) => {
    const record = await tx.vehicleServiceRecord.create({
      data: { vehicleId, serviceCode: t.serviceCode, variant: input.variant ?? null, doneAtKm: input.doneAtKm ?? null, doneAt, source, orderItemId: input.orderItemId ?? null },
    });
    // A newer reading moves the odometer forward (it never goes backwards from a service entry).
    if (input.doneAtKm != null) {
      await tx.garageVehicle.updateMany({
        where: { id: vehicleId, OR: [{ odometerKm: null }, { odometerKm: { lt: input.doneAtKm } }] },
        data: { odometerKm: input.doneAtKm, odometerUpdatedAt: now },
      });
    }
    return { id: record.id, serviceCode: record.serviceCode, doneAtKm: record.doneAtKm, doneAt: record.doneAt.toISOString(), variant: record.variant, source: record.source };
  });
}

export async function deleteServiceRecord(userId: string, vehicleId: string, recordId: string) {
  await ownedVehicle(userId, vehicleId);
  const r = await prisma.vehicleServiceRecord.deleteMany({ where: { id: recordId, vehicleId } });
  if (!r.count) throw notFound('Service record');
}

// ── reminders (worker job)

/**
 * Creates one in-app notification when a service becomes due — at most once per vehicle, service
 * and due cycle (a new service record starts a new cycle). Concurrency-safe: the unique
 * MaintenanceReminder row is the claim, and the notification is written in the same transaction.
 */
export async function maintenanceReminders(now = new Date(), batchSize = 500) {
  const all = await loadTemplates();
  let created = 0;
  let cursor: string | undefined;
  for (;;) {
    const vehicles = await prisma.garageVehicle.findMany({
      where: { deletedAt: null, user: { status: 'ACTIVE' } },
      include: { model: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (!vehicles.length) break;
    cursor = vehicles[vehicles.length - 1].id;
    const records = await latestRecords(vehicles.map((v) => v.id));
    for (const v of vehicles) {
      for (const t of templatesForVehicle(all, { makeId: v.model.makeId, modelId: v.modelId })) {
        const last = records.get(`${v.id}:${t.serviceCode}`) ?? null;
        const st = computeServiceStatus({ intervalKm: t.intervalKm, intervalMonths: t.intervalMonths, variants: t.variants, odometerKm: v.odometerKm, last, now });
        if (st.status !== 'due') continue;
        created += await withTx(async (tx) => {
          const claim = await tx.maintenanceReminder.createMany({ data: [{ vehicleId: v.id, serviceCode: t.serviceCode, cycleKey: st.cycleKey }], skipDuplicates: true });
          if (!claim.count) return 0;
          await notify(tx, {
            audience: 'CUSTOMER',
            userId: v.userId,
            type: 'maintenance.due',
            title: 'حان موعد صيانة سيارتك',
            body: `${t.nameAr} — ${v.model.nameAr} ${v.year}. ${MAINTENANCE_DISCLAIMER.ar}`,
            data: { vehicleId: v.id, serviceCode: t.serviceCode },
          });
          return 1;
        });
      }
    }
    if (vehicles.length < batchSize) break;
  }
  return created;
}
