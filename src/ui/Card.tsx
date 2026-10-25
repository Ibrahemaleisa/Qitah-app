import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, radius, shadow, space } from '@/theme/tokens';

import { Pressable } from './Pressable';

type Props = {
  children: ReactNode;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  padding?: number;
  elevated?: boolean;
  tone?: 'surface' | 'muted' | 'inverse' | 'accent';
  accessibilityLabel?: string;
};

const bgFor = { surface: colors.surface, muted: colors.surfaceMuted, inverse: colors.inverse, accent: colors.accentWash } as const;

export function Card({ children, onPress, style, padding = space.lg, elevated, tone = 'surface', accessibilityLabel }: Props) {
  const base: StyleProp<ViewStyle> = [
    {
      backgroundColor: bgFor[tone],
      borderRadius: radius.lg,
      padding,
      borderWidth: tone === 'surface' ? 1 : 0,
      borderColor: colors.line,
    },
    elevated ? shadow.card : null,
    style,
  ];
  if (onPress) {
    return (
      <Pressable onPress={onPress} pressScale={0.985} style={base} accessibilityLabel={accessibilityLabel}>
        {children}
      </Pressable>
    );
  }
  return <View style={base}>{children}</View>;
}
