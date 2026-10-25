import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withSpring } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import { useAppStore } from '@/store/app-store';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Text } from '@/ui/Text';

export default function OrderSuccess() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { s, money, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const order = useAppStore((st) => st.orders.find((o) => o.id === orderId));
  const scale = useSharedValue(0.3);
  useEffect(() => {
    scale.value = withDelay(120, withSpring(1, { damping: 10, stiffness: 180 }));
  }, [scale]);
  const badge = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, direction: isRTL ? 'rtl' : 'ltr', paddingTop: insets.top + space.huge, paddingBottom: Math.max(insets.bottom, space.lg), paddingHorizontal: gutter }}>
      <View style={{ flex: 1, alignItems: 'center', gap: space.md }}>
        <Animated.View style={[{ width: 96, height: 96, borderRadius: 48, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }, badge]}>
          <Icon name="check" size={46} color="textOnAccent" />
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(250)} style={{ alignItems: 'center', gap: space.xs, marginTop: space.md }}>
          <Text variant="title1" align="center">
            {s.success.title}
          </Text>
          <Text variant="body" color="textSecondary" align="center">
            {s.success.subtitle}
          </Text>
        </Animated.View>
        {order ? (
          <Animated.View entering={FadeInDown.delay(350)} style={{ width: '100%', marginTop: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
            <Row label={s.success.orderNumber} value={order.number} ltr />
            <Row label={s.checkout.items} value={s.common.items(order.lines.reduce((a, l) => a + l.qty, 0))} />
            <Row label={s.success.shipmentsLabel} value={s.success.shipments(order.shipments.length)} />
            <Row label={s.checkout.total} value={money(order.totals.total)} strong />
          </Animated.View>
        ) : null}
        <Animated.View entering={FadeInDown.delay(450)} style={{ width: '100%', marginTop: space.md }}>
          <Notice tone="sample" text={s.success.simulatedNote} />
        </Animated.View>
      </View>
      <View style={{ gap: space.sm }}>
        {order ? <Button label={s.success.track} icon="truck" onPress={() => router.replace(`/order/${order.id}`)} /> : null}
        <Button label={s.success.continueShopping} variant="ghost" onPress={() => router.replace('/')} />
      </View>
    </View>
  );
}

function Row({ label, value, strong, ltr }: { label: string; value: string; strong?: boolean; ltr?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text variant="callout" color="textSecondary">
        {label}
      </Text>
      <Text variant={strong ? 'headline' : 'callout'} weight={strong ? 'bold' : 'semibold'} ltr={ltr}>
        {value}
      </Text>
    </View>
  );
}
