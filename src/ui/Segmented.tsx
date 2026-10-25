import { View } from 'react-native';

import { colors, radius, shadow, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

type Option<T extends string> = { value: T; label: string; hint?: string; icon?: IconName };

type Props<T extends string> = { options: Option<T>[]; value: T; onChange: (v: T) => void };

/** Large segmented selector used for choices like home vs workshop delivery. */
export function Segmented<T extends string>({ options, value, onChange }: Props<T>) {
  return (
    <View style={{ flexDirection: 'row', backgroundColor: colors.surfaceSunken, borderRadius: radius.lg, padding: 4, gap: 4 }}>
      {options.map((o) => {
        const active = o.value === value;
        return (
          <Pressable
            key={o.value}
            onPress={() => onChange(o.value)}
            haptics="tap"
            accessibilityState={{ selected: active }}
            accessibilityLabel={o.label}
            style={[
              { flex: 1, borderRadius: radius.md, paddingVertical: space.sm + 2, paddingHorizontal: space.md, alignItems: 'center', gap: 2, backgroundColor: active ? colors.surface : 'transparent' },
              active ? shadow.card : null,
            ]}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              {o.icon ? <Icon name={o.icon} size={16} color={active ? 'heading' : 'textSecondary'} /> : null}
              <Text variant="bodyStrong" color={active ? 'text' : 'textSecondary'}>
                {o.label}
              </Text>
            </View>
            {o.hint ? (
              <Text variant="micro" color="textTertiary" align="center" numberOfLines={1}>
                {o.hint}
              </Text>
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
