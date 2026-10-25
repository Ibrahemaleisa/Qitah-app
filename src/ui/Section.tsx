import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { colors, space } from '@/theme/tokens';

import { Pressable } from './Pressable';
import { Text } from './Text';

type Props = {
  title: string;
  subtitle?: string;
  action?: { label: string; onPress: () => void };
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Horizontal padding for the header when the content is edge-to-edge. */
  inset?: number;
  /** Optional step number for multi-step flows such as checkout. */
  step?: number;
};

export function Section({ title, subtitle, action, children, style, inset = 0, step }: Props) {
  return (
    <View style={[{ marginTop: space.xxl }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: inset, marginBottom: space.md, gap: space.md }}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {step !== undefined ? (
              <View accessible={false} style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center' }}>
                <Text variant="captionStrong" color="textInverse" align="center" maxFontSizeMultiplier={1.3}>
                  {step}
                </Text>
              </View>
            ) : null}
            <Text variant="title2" accessibilityRole="header" style={{ flexShrink: 1 }} accessibilityLabel={step !== undefined ? `${step}. ${title}` : undefined}>
              {title}
            </Text>
          </View>
          {subtitle ? (
            <Text variant="caption" color="textSecondary">
              {subtitle}
            </Text>
          ) : null}
        </View>
        {action ? (
          <Pressable onPress={action.onPress} hitSlop={8}>
            <Text variant="callout" weight="semibold" color="accentPressed">
              {action.label}
            </Text>
          </Pressable>
        ) : null}
      </View>
      {children}
    </View>
  );
}
