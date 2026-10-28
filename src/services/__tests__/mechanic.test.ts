import type { Vehicle } from '@/domain/types';
import ar from '@/i18n/ar';
import { parseKm, formatKm } from '@/lib/odometer';
import { cartLinesFor, createReview, shareMessage, simulateMechanicApproval, useMechanicReviews } from '@/services/mechanic';
import { useAppStore } from '@/store/app-store';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const camry: Vehicle = { id: 'veh-1', makeId: 'toyota', modelId: 'camry', year: 2022, trim: '', engine: '2.5L I4', vin: '4T1B11HK8KU123456', addedAt: 0 };

describe('send to my mechanic (demo mode)', () => {
  it('creates a sample review with fitment per line and a WhatsApp-friendly Arabic message', async () => {
    const r = await createReview({ lines: [{ offerId: 'o-001', qty: 1 }, { offerId: 'o-025', qty: 2 }], vehicle: camry, note: 'صوت عند الفرملة' });
    expect(r.status).toBe('PENDING');
    expect(r.vehicle?.modelAr).toBe('كامري');
    expect(r.lines.map((l) => l.fit)).toEqual(['catalog', 'universal']);
    expect(useAppStore.getState().mechanicLinks[r.id]).toBe(r.url);
    const msg = shareMessage(ar, r, r.url!);
    expect(msg).toContain(r.url!);
    expect(msg).toContain('تويوتا كامري 2022');
    expect(msg).toContain('بدون تسجيل');
    expect(cartLinesFor(r)).toEqual([]);
  });

  it('one tap adds exactly what the mechanic approved', async () => {
    const r = await createReview({ lines: [{ offerId: 'o-013', qty: 3 }], vehicle: camry });
    simulateMechanicApproval(r.id, 'ورشة تجريبية');
    const done = useMechanicReviews.getState().byId[r.id];
    expect(done.status).toBe('APPROVED');
    expect(done.workshop?.name).toBe('ورشة تجريبية');
    expect(cartLinesFor(done)).toEqual([{ offerId: 'o-013', qty: 3 }]);
  });
});

describe('odometer input', () => {
  it('accepts Arabic digits and separators, rejects nonsense', () => {
    expect(parseKm('45,000')).toBe(45000);
    expect(parseKm('٤٥٬٠٠٠')).toBe(45000);
    expect(parseKm('abc')).toBeUndefined();
    expect(parseKm('99999999')).toBeUndefined();
    expect(formatKm(1234567)).toBe('1,234,567');
  });
});
