import { View } from 'react-native';

import { isRemote } from '@/config/env';
import { deliveryWindow, fastestDelivery } from '@/domain/pricing';
import type { Offer } from '@/domain/types';
import { useI18n } from '@/i18n';
import { colors, radius, space } from '@/theme/tokens';
import { Text } from '@/ui/Text';

/** At-a-glance facts across all in-stock offers: lowest price, fastest delivery, best warranty. */
export function ProductSummary({ offers }: { offers: Offer[] }) {
  const { s, money, isRTL } = useI18n();
  const inStock = offers.filter((o) => o.stock > 0);
  if (inStock.length === 0) return null;
  const minPrice = Math.min(...inStock.map((o) => o.price));
  const windows = inStock
    .map((o) => {
      const f = fastestDelivery(o);
      return f ? deliveryWindow(o, f) : null;
    })
    .filter((w): w is [number, number] => !!w)
    .sort((a, b) => a[1] - b[1]);
  const maxWarranty = Math.max(...inStock.map((o) => o.warrantyMonths));
  const cells: { label: string; value: string; hint?: string }[] = [
    { label: s.product.summaryFrom, value: money(minPrice), hint: s.common.offers(inStock.length) },
    isRemote
      ? (() => {
          // Remote: carrier ETAs are quoted at checkout; show the seller's fastest dispatch instead.
          const fastest = [...inStock].sort((a, b) => a.dispatchDays[1] - b.dispatchDays[1])[0];
          return { label: s.remote.summaryDispatch, value: s.common.days(fastest.dispatchDays[0], fastest.dispatchDays[1]) };
        })()
      : { label: s.product.summaryDelivery, value: windows[0] ? s.common.days(windows[0][0], windows[0][1]) : '—' },
    { label: s.product.summaryWarranty, value: s.product.warrantyMonths(maxWarranty) },
  ];
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
      {cells.map((c, i) => (
        <View
          key={c.label}
          accessible
          accessibilityLabel={`${c.label}: ${c.value}${c.hint ? `, ${c.hint}` : ''}`}
          style={{ flex: 1, paddingVertical: space.md, paddingHorizontal: space.sm, alignItems: 'center', gap: 2, ...(i === 0 ? null : isRTL ? { borderRightWidth: 1, borderRightColor: colors.line } : { borderLeftWidth: 1, borderLeftColor: colors.line }) }}
        >
          <Text variant="micro" color="textTertiary" align="center" numberOfLines={1}>
            {c.label}
          </Text>
          <Text variant="bodyStrong" align="center" numberOfLines={1} adjustsFontSizeToFit>
            {c.value}
          </Text>
          {c.hint ? (
            <Text variant="micro" color="textSecondary" align="center" numberOfLines={1}>
              {c.hint}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  );
}
