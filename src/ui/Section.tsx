import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { space } from '@/theme/tokens';

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
};

export function Section({ title, subtitle, action, children, style, inset = 0 }: Props) {
  return (
    <View style={[{ marginTop: space.xxl }, style]}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', paddingHorizontal: inset, marginBottom: space.md, gap: space.md }}>
        <View style={{ flex: 1 }}>
          <Text variant="title2">{title}</Text>
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
