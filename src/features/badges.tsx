import { View } from 'react-native';

import { LogoSymbol, type SymbolTone } from '@/brand/Logo';
import type { FitStatus } from '@/domain/compatibility';
import type { Condition, PartOrigin } from '@/domain/types';
import { useI18n } from '@/i18n';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { Icon, type IconName } from '@/ui/Icon';
import { Text, type TextColor } from '@/ui/Text';

export function OriginBadge({ origin, short }: { origin: PartOrigin; short?: boolean }) {
  const { s } = useI18n();
  return <Badge label={(short ? s.originShort : s.origin)[origin]} tone={origin === 'oem' ? 'oem' : 'aftermarket'} icon={origin === 'oem' ? 'shield' : undefined} />;
}

export function ConditionBadge({ condition }: { condition: Condition }) {
  const { s } = useI18n();
  const tone: BadgeTone = condition === 'new' ? 'success' : condition === 'used' ? 'used' : 'refurbished';
  return <Badge label={s.condition[condition]} tone={tone} />;
}

/**
 * Compatibility is always shape + text, never colour alone (guidelines p.21, p.31):
 * the full symbol — the piece fitted onto the car — means "fits"; the car alone means
 * "needs confirmation"; spec-based parts get a neutral marker. Nothing is ever claimed
 * as "doesn't fit" because the catalog has no negative fitment data.
 */
export const fitVisuals: Record<FitStatus, { symbol?: SymbolTone; icon?: IconName; color: TextColor }> = {
  catalogMatch: { symbol: 'primary', color: 'heading' },
  sellerReported: { symbol: 'pending', color: 'textSecondary' },
  noData: { symbol: 'faint', color: 'textSecondary' },
  bySpecification: { icon: 'sliders', color: 'textSecondary' },
  noVehicle: { icon: 'plus-circle', color: 'textSecondary' },
};

export function FitMarker({ status, size = 22 }: { status: FitStatus; size?: number }) {
  const v = fitVisuals[status];
  if (v.symbol) return <LogoSymbol width={size} tone={v.symbol} />;
  return <Icon name={v.icon ?? 'help-circle'} size={size * 0.7} color={v.color} />;
}

/** Compact fit label for product cards and lists. */
export function FitBadge({ status }: { status: FitStatus }) {
  const { s } = useI18n();
  const v = fitVisuals[status];
  return (
    <View accessible accessibilityLabel={s.fit[status]} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' }}>
      <FitMarker status={status} size={20} />
      <Text variant="micro" color={v.color} numberOfLines={1}>
        {s.fit[status]}
      </Text>
    </View>
  );
}

export function SampleBadge() {
  const { s } = useI18n();
  return <Badge label={s.common.sampleBadge} tone="info" icon="flag" />;
}
