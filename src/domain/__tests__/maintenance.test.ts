import { computeServiceStatus, GENERIC_MAINTENANCE_TEMPLATES, type StatusResult } from '@/domain/maintenance-core';
import type { Vehicle } from '@/domain/types';
import ar from '@/i18n/ar';
import en from '@/i18n/en';
import { dueLine, kitCartLines, localMaintenance, nextService, statusVisuals, toStatus, type MaintenanceService } from '@/services/maintenance';
import { readRepoFile, readRepoJson } from '@/test-support/repo-files';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const fixtures = readRepoJson<{ name: string; serviceCode: string; odometerKm: number | null; last: { id: string; doneAtKm: number | null; doneAt: string; variant?: string } | null; now: string; expect: StatusResult }[]>(
  'services/api/test/fixtures/maintenance-status.json',
);

describe('maintenance status (parity with the API)', () => {
  it('the app copy of the maintenance core is byte-identical to the server source', () => {
    expect(readRepoFile('src/domain/maintenance-core.ts')).toBe(readRepoFile('services/api/src/lib/maintenance.ts'));
  });

  it.each(fixtures.map((f) => [f.name, f] as const))('%s', (_name, f) => {
    const t = GENERIC_MAINTENANCE_TEMPLATES.find((x) => x.serviceCode === f.serviceCode)!;
    expect(computeServiceStatus({ intervalKm: t.intervalKm, intervalMonths: t.intervalMonths, variants: t.variants, odometerKm: f.odometerKm, last: f.last, now: new Date(f.now) })).toEqual(f.expect);
  });
});

const svc = (status: string, remainingKm: number | null = null, remainingDays: number | null = null) =>
  ({ serviceCode: status, status, remainingKm, remainingDays, kit: { lines: [], missing: [], totalHalalas: 0 } }) as unknown as MaintenanceService;

describe('maintenance status mapping (UI)', () => {
  it('maps every status to a distinct tone and a label in both languages', () => {
    expect(statusVisuals.due.tone).toBe('danger');
    expect(statusVisuals.soon.tone).toBe('warning');
    expect(statusVisuals.ok.tone).toBe('success');
    expect(statusVisuals.unknown.tone).toBe('neutral');
    for (const k of ['due', 'soon', 'ok', 'unknown']) {
      expect(ar.maintenance.status[k]).toBeTruthy();
      expect(en.maintenance.status[k]).toBeTruthy();
    }
  });

  it('never upgrades an unknown server value into "ok"', () => {
    expect(toStatus('due')).toBe('due');
    expect(toStatus('OK')).toBe('unknown');
    expect(toStatus(undefined)).toBe('unknown');
  });

  it('home card picks the most urgent tracked service', () => {
    expect(nextService([svc('ok', 5000), svc('soon', 800), svc('due', -100), svc('unknown')])?.serviceCode).toBe('due');
    expect(nextService([svc('ok', 5000), svc('ok', 1500)])?.remainingKm).toBe(1500);
    expect(nextService([svc('unknown')])).toBeUndefined();
  });

  it('formats remaining / overdue km and days', () => {
    expect(dueLine(en, { remainingKm: 1200, remainingDays: 20 })).toBe('In 1,200 km · Within 20 days');
    expect(dueLine(en, { remainingKm: -500, remainingDays: null })).toBe('Overdue by 500 km');
    expect(dueLine(ar, { remainingKm: null, remainingDays: -3 })).toBe('متأخرة 3 يوماً');
    expect(dueLine(en, { remainingKm: null, remainingDays: null })).toBeNull();
  });
});

describe('demo maintenance (on-device, same rules as the server)', () => {
  const camry: Vehicle = { id: 'veh-1', makeId: 'toyota', modelId: 'camry', year: 2022, trim: '', engine: '2.5L I4', odometerKm: 52_000, addedAt: 0 };
  const now = new Date('2026-10-28T00:00:00Z');

  it('computes status from local records and composes fitment-safe kits', () => {
    const m = localMaintenance(camry, [{ id: 'svc-1', vehicleId: 'veh-1', serviceCode: 'OIL_CHANGE', variant: 'SYNTHETIC', doneAtKm: 41_000, doneAt: '2026-09-28T00:00:00.000Z', createdAt: 1 }], now);
    expect(m.disclaimer.en).toMatch(/owner's manual/);
    const oil = m.services.find((s) => s.serviceCode === 'OIL_CHANGE')!;
    expect(oil.status).toBe('due');
    expect(oil.kit.lines.map((l) => [l.componentKey, l.productId, l.fit])).toEqual([
      ['oil', 'p-oil-0w20-oem', 'universal'],
      ['oilFilter', 'p-oil-filter-kanzen', 'catalog'],
    ]);
    expect(kitCartLines(oil)).toHaveLength(2);
    expect(m.services.find((s) => s.serviceCode === 'CABIN_FILTER')!.status).toBe('unknown');
  });

  it('respects engine-specific fitment and never uses seller-reported parts', () => {
    const v6 = localMaintenance({ ...camry, id: 'veh-2', engine: '3.5L V6' }, [], now);
    const spark = v6.services.find((s) => s.serviceCode === 'SPARK_PLUGS')!;
    expect(spark.kit.lines).toEqual([]);
    expect(spark.kit.missing.map((x) => x.key)).toEqual(['sparkPlugs']);
    const lx = localMaintenance({ ...camry, id: 'veh-3', makeId: 'lexus', modelId: 'lx', year: 2020, engine: '5.7L V8' }, [], now);
    expect(lx.services.find((s) => s.serviceCode === 'OIL_CHANGE')!.kit.missing.map((x) => x.key)).toEqual(['oilFilter']);
  });
});
