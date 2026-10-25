import { useMemo } from 'react';

import type { L10n, Lang } from '@/domain/types';
import { useAppStore } from '@/store/app-store';

import ar, { type Strings } from './ar';
import en from './en';

const dictionaries: Record<Lang, Strings> = { ar, en };

const monthsAr = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
const monthsEn = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatNumber(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  const [int, dec] = rounded.toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  // Prices always show two decimals (guidelines p.21, p.30).
  return `${grouped}.${dec}`;
}

export function createI18n(lang: Lang) {
  const s = dictionaries[lang];
  const isRTL = lang === 'ar';
  return {
    lang,
    s,
    isRTL,
    /** Picks the active language from a bilingual value. */
    tx: (value: L10n) => value[lang],
    money: (n: number) => (isRTL ? `${formatNumber(n)} ${s.common.sar}` : `${s.common.sar} ${formatNumber(n)}`),
    number: formatNumber,
    date: (ts: number) => {
      const d = new Date(ts);
      const month = (isRTL ? monthsAr : monthsEn)[d.getMonth()];
      return isRTL ? `${d.getDate()} ${month} ${d.getFullYear()}` : `${month} ${d.getDate()}, ${d.getFullYear()}`;
    },
    time: (ts: number) => {
      const d = new Date(ts);
      const h = d.getHours();
      const m = d.getMinutes().toString().padStart(2, '0');
      const h12 = h % 12 === 0 ? 12 : h % 12;
      const suffix = isRTL ? (h < 12 ? 'ص' : 'م') : h < 12 ? 'AM' : 'PM';
      return `${h12}:${m} ${suffix}`;
    },
    textAlign: (isRTL ? 'right' : 'left') as 'right' | 'left',
    writingDirection: (isRTL ? 'rtl' : 'ltr') as 'rtl' | 'ltr',
  };
}

export type I18n = ReturnType<typeof createI18n>;

export function useI18n(): I18n {
  const lang = useAppStore((st) => st.lang);
  return useMemo(() => createI18n(lang), [lang]);
}
