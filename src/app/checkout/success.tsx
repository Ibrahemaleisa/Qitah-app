import { router, useLocalSearchParams } from 'expo-router';
import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import { useAppStore } from '@/store/app-store';
import { LogoSymbol } from '@/brand/Logo';
import { brandEasing, enterUp } from '@/theme/motion';
import { colors, gutter, motion, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Notice } from '@/ui/Notice';
import { Text } from '@/ui/Text';

export default function OrderSuccess() {
  const { orderId } = useLocalSearchParams<{ orderId: string }>();
  const { s, money, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const order = useAppStore((st) => st.orders.find((o) => o.id === orderId));
  // Confirmation reuses the logo's idea: the piece fits onto the car (guidelines p.25).
  const fit = useSharedValue(0);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    fit.value = reduceMotion ? 1 : withDelay(150, withTiming(1, { duration: motion.slow, easing: brandEasing }));
  }, [fit, reduceMotion]);
  const pieceStyle = useAnimatedStyle(() => ({ opacity: 0.4 + fit.value * 0.6, transform: [{ translateX: (1 - fit.value) * 14 }, { translateY: (1 - fit.value) * 12 }] }));

  return (
    <View style={{ flex: 1, backgroundColor: colors.background, direction: isRTL ? 'rtl' : 'ltr', paddingTop: insets.top + space.huge, paddingBottom: Math.max(insets.bottom, space.lg), paddingHorizontal: gutter }}>
      <View style={{ flex: 1, alignItems: 'center', gap: space.md }}>
        <View style={{ width: 140, height: 69 }} accessible={false}>
          <View style={StyleSheet.absoluteFill}>
            <LogoSymbol width={140} layer="car" />
          </View>
          <Animated.View style={[StyleSheet.absoluteFill, pieceStyle]}>
            <LogoSymbol width={140} layer="piece" />
          </Animated.View>
        </View>
        <Animated.View entering={enterUp(1)} style={{ alignItems: 'center', gap: space.xs, marginTop: space.md }}>
          <Text variant="title1" align="center">
            {s.success.title}
          </Text>
          <Text variant="body" color="textSecondary" align="center">
            {s.success.subtitle}
          </Text>
        </Animated.View>
        {order ? (
          <Animated.View entering={enterUp(2)} style={{ width: '100%', marginTop: space.lg, backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
            <Row label={s.success.orderNumber} value={order.number} ltr />
            <Row label={s.checkout.items} value={s.common.items(order.lines.reduce((a, l) => a + l.qty, 0))} />
            <Row label={s.success.shipmentsLabel} value={s.success.shipments(order.shipments.length)} />
            <Row label={s.checkout.total} value={money(order.totals.total)} strong />
          </Animated.View>
        ) : null}
        <Animated.View entering={enterUp(3)} style={{ width: '100%', marginTop: space.md }}>
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
