import type { ReactNode } from 'react';
import { View } from 'react-native';

import { colors, radius, space } from '@/theme/tokens';

import { Pressable } from './Pressable';
import { Text } from './Text';

type Props = {
  selected: boolean;
  onPress: () => void;
  title: string;
  subtitle?: string;
  trailing?: ReactNode;
  leading?: ReactNode;
  disabled?: boolean;
  multi?: boolean;
};

/** A selectable row with a radio (or checkbox) indicator. */
export function ChoiceRow({ selected, onPress, title, subtitle, trailing, leading, disabled, multi }: Props) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      haptics="tap"
      pressScale={0.985}
      accessibilityRole={multi ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={title}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: space.md,
        padding: space.lg,
        borderRadius: radius.md,
        borderWidth: selected ? 1.5 : 1,
        borderColor: selected ? colors.text : colors.line,
        backgroundColor: colors.surface,
      }}
    >
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: multi ? 6 : 11,
          borderWidth: selected ? 0 : 1.5,
          borderColor: colors.lineStrong,
          backgroundColor: selected ? colors.accent : 'transparent',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {selected ? <View style={{ width: multi ? 10 : 8, height: multi ? 10 : 8, borderRadius: multi ? 2 : 4, backgroundColor: colors.surface }} /> : null}
      </View>
      {leading}
      <View style={{ flex: 1 }}>
        <Text variant="bodyStrong">{title}</Text>
        {subtitle ? (
          <Text variant="caption" color="textSecondary">
            {subtitle}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  );
}
