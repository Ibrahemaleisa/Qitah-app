import { View } from 'react-native';

import { useI18n } from '@/i18n';
import { colors, radius } from '@/theme/tokens';

import { Icon } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

type Props = { value: number; onChange: (v: number) => void; max: number; min?: number };

export function Stepper({ value, onChange, max, min = 0 }: Props) {
  const { s } = useI18n();
  const btn = (icon: 'minus' | 'plus' | 'trash-2', next: number, disabled: boolean, label: string) => (
    <Pressable
      onPress={() => onChange(next)}
      disabled={disabled}
      haptics="tap"
      pressScale={0.88}
      accessibilityLabel={label}
      hitSlop={4}
      style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: radius.pill }}
    >
      <Icon name={icon} size={15} color={icon === 'trash-2' ? 'danger' : 'text'} />
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surfaceSunken, borderRadius: radius.pill, padding: 2 }}>
      {btn(value <= 1 && min === 0 ? 'trash-2' : 'minus', value - 1, value <= min, s.common.remove)}
      <Text variant="bodyStrong" align="center" style={{ minWidth: 26 }} ltr>
        {value}
      </Text>
      {btn('plus', value + 1, value >= max, s.common.add)}
    </View>
  );
}
