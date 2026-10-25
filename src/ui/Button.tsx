import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

/**
 * Buttons (guidelines p.21, p.33): one blue primary per screen for the most important action;
 * secondary actions are outlined in blue. Orange is never a button colour.
 * `dark` is kept as an alias of `primary` for existing call sites.
 */
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

type Look = { bg: string; fg: keyof typeof colors; border?: string };

const looks: Record<Variant, Look> = {
  primary: { bg: colors.primary, fg: 'textInverse' },
  dark: { bg: colors.primary, fg: 'textInverse' },
  secondary: { bg: colors.surface, fg: 'heading', border: colors.primary },
  ghost: { bg: 'transparent', fg: 'link' },
  danger: { bg: colors.surface, fg: 'danger', border: colors.danger },
};

const disabledLooks: Record<Variant, Look> = {
  primary: { bg: colors.line, fg: 'textTertiary' },
  dark: { bg: colors.line, fg: 'textTertiary' },
  secondary: { bg: colors.surface, fg: 'textTertiary', border: colors.line },
  ghost: { bg: 'transparent', fg: 'textTertiary' },
  danger: { bg: colors.surface, fg: 'textTertiary', border: colors.line },
};

const sizes: Record<Size, { height: number; padding: number; variant: 'bodyStrong' | 'callout' | 'captionStrong'; icon: number }> = {
  lg: { height: 54, padding: space.xl, variant: 'bodyStrong', icon: 20 },
  md: { height: 46, padding: space.lg, variant: 'bodyStrong', icon: 18 },
  sm: { height: 36, padding: space.md, variant: 'captionStrong', icon: 16 },
};

export function Button({ label, onPress, variant = 'primary', size = 'lg', icon, trailing, loading, disabled, style, accessibilityHint }: Props) {
  const inactive = disabled && !loading;
  const look = inactive ? disabledLooks[variant] : looks[variant];
  const s = sizes[size];
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      dimWhenDisabled={false}
      haptics={variant === 'primary' || variant === 'dark' ? 'impact' : 'tap'}
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      hitSlop={size === 'sm' ? 4 : undefined}
      style={[
        {
          minHeight: s.height,
          paddingHorizontal: s.padding,
          borderRadius: radius.md,
          backgroundColor: look.bg,
          borderWidth: look.border ? 1.5 : 0,
          borderColor: look.border,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: trailing ? 'space-between' : 'center',
          gap: space.sm,
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors[look.fg]} />
      ) : (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexShrink: 1 }}>
            {icon ? <Icon name={icon} size={s.icon} color={look.fg} /> : null}
            <Text variant={s.variant} color={look.fg} numberOfLines={1}>
              {label}
            </Text>
          </View>
          {trailing ? (
            <Text variant={s.variant} color={look.fg} numberOfLines={1} style={{ fontVariant: ['tabular-nums'] }}>
              {trailing}
            </Text>
          ) : null}
        </>
      )}
    </Pressable>
  );
}
