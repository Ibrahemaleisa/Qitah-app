import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

type Props = {
  icon: IconName;
  onPress?: () => void;
  label: string;
  tone?: 'surface' | 'plain' | 'dark' | 'accent';
  size?: number;
  iconColor?: keyof typeof colors;
  badge?: number;
  style?: StyleProp<ViewStyle>;
};

export function IconButton({ icon, onPress, label, tone = 'surface', size = 42, iconColor, badge, style }: Props) {
  const bg = tone === 'surface' ? colors.surface : tone === 'dark' ? colors.inverse : tone === 'accent' ? colors.accent : 'transparent';
  const fg = iconColor ?? (tone === 'dark' || tone === 'accent' ? 'textInverse' : 'text');
  return (
    <Pressable
      onPress={onPress}
      haptics="tap"
      pressScale={0.92}
      accessibilityLabel={label}
      hitSlop={6}
      style={[
        {
          width: size,
          height: size,
          borderRadius: radius.pill,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          borderWidth: tone === 'surface' ? 1 : 0,
          borderColor: colors.line,
        },
        style,
      ]}
    >
      <Icon name={icon} size={size * 0.46} color={fg} />
      {badge ? (
        <View style={{ position: 'absolute', top: -2, end: -2, minWidth: 18, height: 18, borderRadius: 9, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 }}>
          <Text variant="micro" color="textOnAccent" style={{ lineHeight: 14 }}>
            {badge > 9 ? '9+' : badge}
          </Text>
        </View>
      ) : null}
    </Pressable>
  );
}
