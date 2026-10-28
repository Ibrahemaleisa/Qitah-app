import { create } from 'zustand';

import { garageApi } from '@/api/endpoints';
import type { ApiKitLine, ApiMaintenance, ApiMaintenanceService, ApiServiceStatus, ServiceRecordInput } from '@/api/types';
import { isRemote } from '@/config/env';
import { allProducts } from '@/data/catalog';
import { offersForProduct } from '@/data/offers';
import { getModel } from '@/data/vehicles';
import { getFitStatus } from '@/domain/compatibility';
import {
  computeServiceStatus,
  GENERIC_MAINTENANCE_TEMPLATES,
  MAINTENANCE_DISCLAIMER,
  matchesComponent,
  statusRank,
  templatesForVehicle,
  type MaintenanceTemplateData,
} from '@/domain/maintenance-core';
import type { Product, Vehicle } from '@/domain/types';
import type { Strings } from '@/i18n/ar';
import { formatKm } from '@/lib/odometer';
import { isLocalId } from '@/services/remote/account';
import { useAppStore, type LocalServiceRecord } from '@/store/app-store';

/**
 * Maintenance schedule for a garage vehicle, in the API's shape in both modes:
 * - remote (signed in, server vehicle): GET /v1/me/vehicles/:id/maintenance;
 * - demo / guest: computed on the device with the same core (src/domain/maintenance-core.ts, a byte-identical
 *   copy of the server's) over the bundled catalog and locally stored service records.
 */

export type MaintenanceView = ApiMaintenance;
export type MaintenanceService = ApiMaintenanceService;

const usesServer = (vehicle: Vehicle) => isRemote && !!useAppStore.getState().user && !isLocalId(vehicle.id);

// ── demo / on-device

function kitFor(template: MaintenanceTemplateData, vehicle: Vehicle, products: Product[]): ApiMaintenanceService['kit'] {
  const lines: ApiKitLine[] = [];
  const missing: { key: string; name: { ar: string; en: string } }[] = [];
  for (const c of template.components) {
    const options = products
      .filter((p) => matchesComponent({ categoryId: p.categoryId, keywords: p.keywords, nameAr: p.name.ar, nameEn: p.name.en }, c))
      .map((p) => {
        const status = getFitStatus(p, vehicle);
        // Same rule as the server: catalog-verified first, then by specification; seller-reported never.
        const fit = status === 'catalogMatch' ? ('catalog' as const) : status === 'bySpecification' ? ('universal' as const) : null;
        const offer = offersForProduct(p.id)
          .filter((o) => o.stock > 0 && !o.unavailable)
          .sort((a, b) => a.price - b.price || a.id.localeCompare(b.id))[0];
        return fit && offer ? { p, fit, offer } : null;
      })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => (a.fit === b.fit ? 0 : a.fit === 'catalog' ? -1 : 1) || a.offer.price - b.offer.price || a.p.id.localeCompare(b.p.id));
    const best = options[0];
    if (!best) {
      missing.push({ key: c.key, name: { ar: c.nameAr, en: c.nameEn } });
      continue;
    }
    lines.push({
      componentKey: c.key,
      component: { ar: c.nameAr, en: c.nameEn },
      productId: best.p.id,
      offerId: best.offer.id,
      name: best.p.name,
      brand: best.p.brand,
      partNumber: best.p.partNumber,
      priceHalalas: Math.round(best.offer.price * 100),
      available: best.offer.stock,
      quantity: 1,
      fit: best.fit,
    });
  }
  return { lines, missing, totalHalalas: lines.reduce((s, l) => s + l.priceHalalas * l.quantity, 0) };
}

export function localMaintenance(vehicle: Vehicle, records: LocalServiceRecord[], now = new Date(), products: Product[] = allProducts()): MaintenanceView {
  const makeId = vehicle.makeId || getModel(vehicle.modelId)?.makeId;
  const templates = templatesForVehicle(GENERIC_MAINTENANCE_TEMPLATES, { makeId, modelId: vehicle.modelId });
  const mine = records.filter((r) => r.vehicleId === vehicle.id).sort((a, b) => b.doneAt.localeCompare(a.doneAt) || b.createdAt - a.createdAt);
  const services = templates.map((t): ApiMaintenanceService => {
    const last = mine.find((r) => r.serviceCode === t.serviceCode) ?? null;
    const st = computeServiceStatus({
      intervalKm: t.intervalKm,
      intervalMonths: t.intervalMonths,
      variants: t.variants,
      odometerKm: vehicle.odometerKm ?? null,
      last: last ? { id: last.id, doneAtKm: last.doneAtKm ?? null, doneAt: last.doneAt, variant: last.variant ?? null } : null,
      now,
    });
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
      lastRecord: last ? { id: last.id, doneAtKm: last.doneAtKm ?? null, doneAt: last.doneAt, variant: last.variant ?? null, source: 'MANUAL' } : null,
      kit: kitFor(t, vehicle, products),
    };
  });
  return {
    vehicle: { id: vehicle.id, modelId: vehicle.modelId, year: vehicle.year, engine: vehicle.engine, odometerKm: vehicle.odometerKm ?? null, odometerUpdatedAt: null },
    disclaimer: MAINTENANCE_DISCLAIMER,
    services,
    proposals: [],
  };
}

// ── remote cache

type Entry = { data?: MaintenanceView; state: 'loading' | 'ready' | 'error' };
export const useRemoteMaintenance = create<{ byVehicle: Record<string, Entry> }>()(() => ({ byVehicle: {} }));

export async function refreshMaintenance(vehicle: Vehicle) {
  if (!usesServer(vehicle)) return;
  useRemoteMaintenance.setState((s) => ({ byVehicle: { ...s.byVehicle, [vehicle.id]: { ...s.byVehicle[vehicle.id], state: 'loading' } } }));
  try {
    const data = await garageApi.maintenance(vehicle.id);
    useRemoteMaintenance.setState((s) => ({ byVehicle: { ...s.byVehicle, [vehicle.id]: { data, state: 'ready' } } }));
    if (data.vehicle.odometerKm != null && data.vehicle.odometerKm !== vehicle.odometerKm) useAppStore.getState().updateVehicle(vehicle.id, { odometerKm: data.vehicle.odometerKm });
  } catch (e) {
    useRemoteMaintenance.setState((s) => ({ byVehicle: { ...s.byVehicle, [vehicle.id]: { ...s.byVehicle[vehicle.id], state: 'error' } } }));
    throw e;
  }
}

/** The maintenance view for a vehicle: live server data (remote) or computed on the device (demo). */
export function useMaintenance(vehicle: Vehicle | undefined): { data?: MaintenanceView; state: Entry['state'] } {
  const records = useAppStore((s) => s.serviceRecords);
  const remote = useRemoteMaintenance((s) => (vehicle ? s.byVehicle[vehicle.id] : undefined));
  if (!vehicle) return { state: 'ready' };
  if (usesServer(vehicle)) return remote ?? { state: 'loading' };
  return { data: localMaintenance(vehicle, records), state: 'ready' };
}

export async function markServiceDone(vehicle: Vehicle, input: ServiceRecordInput) {
  if (usesServer(vehicle)) {
    await garageApi.recordService(vehicle.id, input);
    if (input.doneAtKm != null && (vehicle.odometerKm == null || input.doneAtKm > vehicle.odometerKm)) useAppStore.getState().updateVehicle(vehicle.id, { odometerKm: input.doneAtKm });
    await refreshMaintenance(vehicle).catch(() => {});
    return;
  }
  const store = useAppStore.getState();
  store.addServiceRecord({ vehicleId: vehicle.id, serviceCode: input.serviceCode, variant: input.variant, doneAtKm: input.doneAtKm, doneAt: input.doneAt ?? new Date().toISOString() });
  if (input.doneAtKm != null && (vehicle.odometerKm == null || input.doneAtKm > vehicle.odometerKm)) store.updateVehicle(vehicle.id, { odometerKm: input.doneAtKm });
}

// ── presentation helpers (pure; unit-tested)

export type StatusTone = 'danger' | 'warning' | 'success' | 'neutral';

/** Badge tone + icon for each status. */
export const statusVisuals: Record<ApiServiceStatus, { tone: StatusTone; icon: 'alert-octagon' | 'clock' | 'check-circle' | 'help-circle' }> = {
  due: { tone: 'danger', icon: 'alert-octagon' },
  soon: { tone: 'warning', icon: 'clock' },
  ok: { tone: 'success', icon: 'check-circle' },
  unknown: { tone: 'neutral', icon: 'help-circle' },
};

/** Unknown server values never upgrade into "ok". */
export function toStatus(value: unknown): ApiServiceStatus {
  return value === 'due' || value === 'soon' || value === 'ok' ? value : 'unknown';
}

/** The service to show on the home card: the most urgent tracked one (due, then soon, then the nearest ok). */
export function nextService(services: MaintenanceService[]): MaintenanceService | undefined {
  const ranked = services
    .map((s) => ({ s, status: toStatus(s.status) }))
    .filter((x) => x.status !== 'unknown')
    .sort((a, b) => statusRank(a.status) - statusRank(b.status) || (a.s.remainingKm ?? Infinity) - (b.s.remainingKm ?? Infinity) || (a.s.remainingDays ?? Infinity) - (b.s.remainingDays ?? Infinity));
  return ranked[0]?.s;
}

/** Kit lines that can go into the cart now (in stock). */
export function kitCartLines(service: Pick<MaintenanceService, 'kit'>): { offerId: string; qty: number }[] {
  return service.kit.lines.filter((l) => l.available > 0).map((l) => ({ offerId: l.offerId, qty: l.quantity }));
}

/** "In 1,200 km · Within 20 days" / "Overdue by 500 km". */
export function dueLine(s: Strings, svc: Pick<MaintenanceService, 'remainingKm' | 'remainingDays'>): string | null {
  const parts: string[] = [];
  if (svc.remainingKm != null) parts.push(svc.remainingKm <= 0 ? s.maintenance.overdueKm(formatKm(-svc.remainingKm)) : s.maintenance.remainingKm(formatKm(svc.remainingKm)));
  if (svc.remainingDays != null) parts.push(svc.remainingDays <= 0 ? s.maintenance.overdueDays(-svc.remainingDays) : s.maintenance.remainingDays(svc.remainingDays));
  return parts.length ? parts.join(' · ') : null;
}
