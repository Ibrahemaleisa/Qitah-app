import { View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info' | 'oem' | 'aftermarket' | 'used' | 'refurbished' | 'inverse';

const tones: Record<BadgeTone, { bg: string; fg: keyof typeof colors }> = {
  neutral: { bg: colors.surfaceSunken, fg: 'textSecondary' },
  accent: { bg: colors.accentSoft, fg: 'accentPressed' },
  success: { bg: colors.successSoft, fg: 'success' },
  warning: { bg: colors.warningSoft, fg: 'warning' },
  danger: { bg: colors.dangerSoft, fg: 'danger' },
  info: { bg: colors.infoSoft, fg: 'info' },
  oem: { bg: colors.inverse, fg: 'textInverse' },
  aftermarket: { bg: colors.aftermarketSoft, fg: 'aftermarket' },
  used: { bg: colors.usedSoft, fg: 'used' },
  refurbished: { bg: colors.refurbishedSoft, fg: 'refurbished' },
  inverse: { bg: colors.inverseMuted, fg: 'textInverse' },
};

export function Badge({ label, tone = 'neutral', icon }: { label: string; tone?: BadgeTone; icon?: IconName }) {
  const t = tones[tone];
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, backgroundColor: t.bg, borderRadius: radius.pill, paddingHorizontal: space.sm, paddingVertical: 2 }}>
      {icon ? <Icon name={icon} size={11} color={t.fg} /> : null}
      <Text variant="micro" color={t.fg} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}
