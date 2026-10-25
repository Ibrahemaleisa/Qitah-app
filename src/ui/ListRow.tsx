import type { ReactNode } from 'react';
import { View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

type Props = {
  icon?: IconName;
  title: string;
  subtitle?: string;
  value?: string;
  onPress?: () => void;
  right?: ReactNode;
  destructive?: boolean;
  last?: boolean;
};

export function ListRow({ icon, title, subtitle, value, onPress, right, destructive, last }: Props) {
  const body = (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.md + 2, paddingHorizontal: space.lg, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line }}>
      {icon ? (
        <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: destructive ? colors.dangerSoft : colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={18} color={destructive ? 'danger' : 'text'} />
        </View>
      ) : null}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong" weight="medium" color={destructive ? 'danger' : 'text'}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="caption" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="callout" color="textSecondary">
          {value}
        </Text>
      ) : null}
      {right}
      {onPress && !right ? <Icon name="chevron-right" size={18} color="textTertiary" /> : null}
    </View>
  );
  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} pressScale={0.99} haptics="tap" accessibilityLabel={title}>
      {body}
    </Pressable>
  );
}

export function ListGroup({ children }: { children: ReactNode }) {
  return <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' }}>{children}</View>;
}
