import { Platform, Switch, View } from 'react-native';

import { colors } from '@/theme/tokens';

type Props = { value: boolean; onChange: (v: boolean) => void; label: string };

/** Brand-coloured switch. On web the RN-Web switch mis-positions its thumb in RTL, so it is pinned LTR there. */
export function Toggle({ value, onChange, label }: Props) {
  const control = (
    <Switch
      value={value}
      onValueChange={onChange}
      trackColor={{ true: colors.primary, false: colors.lineStrong }}
      thumbColor={colors.surface}
      ios_backgroundColor={colors.lineStrong}
      accessibilityLabel={label}
      {...(Platform.OS === 'web' ? { activeThumbColor: colors.surface } : null)}
    />
  );
  return Platform.OS === 'web' ? <View style={{ direction: 'ltr' }}>{control}</View> : control;
}
