import { colors, radius, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Pressable } from './Pressable';
import { Text } from './Text';

type Props = {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  icon?: IconName;
  count?: number;
};

export function Chip({ label, selected, onPress, icon, count }: Props) {
  return (
    <Pressable
      onPress={onPress}
      haptics="tap"
      hitSlop={{ top: 4, bottom: 4 }}
      accessibilityLabel={count ? `${label} (${count})` : label}
      accessibilityState={{ selected }}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
        height: 36,
        paddingHorizontal: space.md + 2,
        borderRadius: radius.pill,
        backgroundColor: selected ? colors.inverse : colors.surface,
        borderWidth: 1,
        borderColor: selected ? colors.inverse : colors.line,
      }}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? 'textInverse' : 'text'} /> : null}
      <Text variant="callout" weight="medium" color={selected ? 'textInverse' : 'text'} numberOfLines={1}>
        {label}
      </Text>
      {count ? (
        <Text variant="micro" color={selected ? 'accent' : 'textTertiary'}>
          {count}
        </Text>
      ) : null}
    </Pressable>
  );
}
