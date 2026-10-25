import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

type Variant = 'primary' | 'dark' | 'secondary' | 'ghost' | 'danger';
type Size = 'lg' | 'md' | 'sm';

type Props = {
  label: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  trailing?: string;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityHint?: string;
};

const palettes: Record<Variant, { bg: string; fg: keyof typeof colors; border?: string }> = {
  primary: { bg: colors.accent, fg: 'textOnAccent' },
  dark: { bg: colors.inverse, fg: 'textInverse' },
  secondary: { bg: colors.surface, fg: 'text', border: colors.lineStrong },
  ghost: { bg: 'transparent', fg: 'text' },
  danger: { bg: colors.dangerSoft, fg: 'danger' },
};

const sizes: Record<Size, { height: number; padding: number; variant: 'bodyStrong' | 'callout' | 'captionStrong'; icon: number }> = {
  lg: { height: 56, padding: space.xxl, variant: 'bodyStrong', icon: 20 },
  md: { height: 46, padding: space.lg, variant: 'bodyStrong', icon: 18 },
  sm: { height: 34, padding: space.md, variant: 'captionStrong', icon: 15 },
};

export function Button({ label, onPress, variant = 'primary', size = 'lg', icon, trailing, loading, disabled, style, accessibilityHint }: Props) {
  const p = palettes[variant];
  const s = sizes[size];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      haptics={variant === 'primary' || variant === 'dark' ? 'impact' : 'tap'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={[
        {
          height: s.height,
          paddingHorizontal: s.padding,
          borderRadius: size === 'sm' ? radius.sm : radius.lg,
          backgroundColor: p.bg,
          borderWidth: p.border ? 1 : 0,
          borderColor: p.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: trailing ? 'space-between' : 'center',
          gap: space.sm,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors[p.fg]} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {icon ? <Icon name={icon} size={s.icon} color={p.fg} /> : null}
            <Text variant={s.variant} color={p.fg} numberOfLines={1}>
              {label}
            </Text>
          </View>
          {trailing ? (
            <Text variant={s.variant} color={p.fg} numberOfLines={1}>
              {trailing}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}
