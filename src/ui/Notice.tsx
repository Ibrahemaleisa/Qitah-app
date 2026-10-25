import { View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Tone = 'info' | 'warning' | 'sample' | 'success' | 'danger';

const tones: Record<Tone, { bg: string; fg: keyof typeof colors; icon: IconName }> = {
  info: { bg: colors.infoSoft, fg: 'info', icon: 'info' },
  warning: { bg: colors.warningSoft, fg: 'warning', icon: 'alert-triangle' },
  sample: { bg: colors.infoSoft, fg: 'info', icon: 'flag' },
  success: { bg: colors.successSoft, fg: 'success', icon: 'check-circle' },
  danger: { bg: colors.dangerSoft, fg: 'danger', icon: 'alert-octagon' },
};

/** Inline message for disclosures (sample data, simulated payments, unverified fitment). */
export function Notice({ text, tone = 'info', icon }: { text: string; tone?: Tone; icon?: IconName }) {
  const t = tones[tone];
  return (
    <View style={{ flexDirection: 'row', gap: space.sm, alignItems: 'flex-start', backgroundColor: t.bg, borderRadius: radius.md, padding: space.md }}>
      <View style={{ paddingTop: 2 }}>
        <Icon name={icon ?? t.icon} size={16} color={t.fg} />
      </View>
      <Text variant="caption" color={t.fg} style={{ flex: 1 }}>
        {text}
      </Text>
    </View>
  );
}
