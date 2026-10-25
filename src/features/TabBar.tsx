import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { useEffect, useRef } from 'react';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, useReducedMotion, useSharedValue, withSequence, withSpring, withTiming } from 'react-native-reanimated';

import { PieceMark } from '@/brand/Logo';
import { useI18n } from '@/i18n';
import { useCartCount } from '@/store/app-store';
import { brandEasing } from '@/theme/motion';
import { colors, motion, space } from '@/theme/tokens';
import { Icon, type IconName } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Text } from '@/ui/Text';

const ICONS: Record<string, IconName> = {
  index: 'home',
  search: 'search',
  cart: 'shopping-bag',
  orders: 'package',
  account: 'user',
};

export function TabBar({ state, emitter, navigateToTab, insets }: BottomTabBarProps) {
  const { s, isRTL } = useI18n();
  const cartCount = useCartCount();
  const labels: Record<string, string> = { index: s.tabs.home, search: s.tabs.search, cart: s.tabs.cart, orders: s.tabs.orders, account: s.tabs.account };

  return (
    <View
      style={{
        direction: isRTL ? 'rtl' : 'ltr',
        flexDirection: 'row',
        backgroundColor: colors.surface,
        borderTopWidth: 1,
        borderTopColor: colors.line,
        paddingTop: space.sm,
        paddingBottom: Math.max(insets.bottom, space.sm),
        paddingHorizontal: space.sm,
      }}
    >
      {state.routes.map((route, index) => {
        const focused = index === state.index;
        const onPress = () => {
          const event = emitter.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigateToTab(route.key);
        };
        return (
          <TabItem
            key={route.key}
            label={labels[route.name] ?? route.name}
            icon={ICONS[route.name] ?? 'circle'}
            focused={focused}
            badge={route.name === 'cart' ? cartCount : 0}
            onPress={onPress}
          />
        );
      })}
    </View>
  );
}

/** Active tab: orange icon (the only orange in the bar, guidelines p.15) and a blue label. */
function TabItem({ label, icon, focused, badge, onPress }: { label: string; icon: IconName; focused: boolean; badge: number; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      haptics="tap"
      pressScale={0.92}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={badge > 0 ? `${label}, ${badge}` : label}
      style={{ flex: 1, alignItems: 'center', gap: 2, minHeight: 44 }}
    >
      <View style={{ width: 52, height: 30, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={22} color={focused ? 'accent' : 'textSecondary'} />
        {badge > 0 ? <CartBadge value={badge} /> : null}
      </View>
      <Text variant="micro" color={focused ? 'heading' : 'textSecondary'} weight={focused ? 'bold' : 'medium'} align="center" numberOfLines={1} maxFontSizeMultiplier={1.3}>
        {label}
      </Text>
    </Pressable>
  );
}

/**
 * Cart count. When it increases, a small orange piece drops into the cart icon within 250ms
 * (guidelines p.25) and the count bumps — feedback that never delays the action itself.
 */
function CartBadge({ value }: { value: number }) {
  const scale = useSharedValue(1);
  const drop = useSharedValue(1);
  const previous = useRef(value);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    if (value > previous.current && !reduceMotion) {
      drop.value = 0;
      drop.value = withTiming(1, { duration: motion.slow, easing: brandEasing });
      scale.value = withSequence(withTiming(1.3, { duration: 120 }), withSpring(1, { damping: 12, stiffness: 260 }));
    }
    previous.current = value;
  }, [value, scale, drop, reduceMotion]);
  const badgeStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));
  const pieceStyle = useAnimatedStyle(() => ({
    opacity: drop.value < 1 ? 1 - drop.value * 0.9 : 0,
    transform: [{ translateY: -22 + drop.value * 22 }, { scale: 1 - drop.value * 0.35 }],
  }));
  return (
    <>
      <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: 2 }, pieceStyle]}>
        <PieceMark width={18} />
      </Animated.View>
      <Animated.View
        style={[
          { position: 'absolute', top: -2, end: 6, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.surface },
          badgeStyle,
        ]}
      >
        <Text variant="micro" color="textInverse" style={{ fontSize: 10, lineHeight: 13 }} tabular maxFontSizeMultiplier={1.2}>
          {value > 9 ? '9+' : value}
        </Text>
      </Animated.View>
    </>
  );
}
