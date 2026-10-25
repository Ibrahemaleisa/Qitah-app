import { View } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';

import { colors, radius, space } from '@/theme/tokens';

import { Button } from './Button';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type Props = {
  icon: IconName;
  title: string;
  body?: string;
  action?: { label: string; onPress: () => void };
};

export function EmptyState({ icon, title, body, action }: Props) {
  return (
    <Animated.View entering={FadeInDown.duration(320)} style={{ alignItems: 'center', paddingVertical: space.huge, paddingHorizontal: space.xxl, gap: space.md }}>
      <View style={{ width: 76, height: 76, borderRadius: radius.xl, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, alignItems: 'center', justifyContent: 'center', marginBottom: space.sm }}>
        <Icon name={icon} size={30} color="accent" />
      </View>
      <Text variant="title2" align="center">
        {title}
      </Text>
      {body ? (
        <Text variant="callout" color="textSecondary" align="center" style={{ maxWidth: 300 }}>
          {body}
        </Text>
      ) : null}
      {action ? <Button label={action.label} onPress={action.onPress} variant="dark" size="md" style={{ marginTop: space.sm, minWidth: 180 }} /> : null}
    </Animated.View>
  );
}
