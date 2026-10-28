import { arrivalLabel, riyadhToday } from '@/domain/deliveredPrice';
import type { Strings } from '@/i18n/ar';

/** "يصلك اليوم" / "يصلك غداً" / "يصلك الأحد" / a date further out. */
export function arrivalText(s: Strings, arrivesBy: string, now: number = Date.now()): string {
  const label = arrivalLabel(arrivesBy, riyadhToday(now));
  switch (label.kind) {
    case 'today':
      return s.trust.arrivesToday;
    case 'tomorrow':
      return s.trust.arrivesTomorrow;
    case 'weekday':
      return s.trust.arrivesOn(s.trust.weekdays[label.weekday]);
    case 'date':
      return s.trust.arrivesOn(label.date);
  }
}
