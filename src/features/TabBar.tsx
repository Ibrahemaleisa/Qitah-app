import type { BottomTabBarProps } from 'expo-router/js-tabs';
import { View } from 'react-native';
import Animated, { useAnimatedStyle, withSpring } from 'react-native-reanimated';

import { useI18n } from '@/i18n';
import { useCartCount } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
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

function TabItem({ label, icon, focused, badge, onPress }: { label: string; icon: IconName; focused: boolean; badge: number; onPress: () => void }) {
  const pill = useAnimatedStyle(() => ({
    backgroundColor: focused ? colors.accentSoft : 'transparent',
    transform: [{ scale: withSpring(focused ? 1 : 0.9, { damping: 15, stiffness: 220 }) }],
  }));
  return (
    <Pressable
      onPress={onPress}
      haptics="tap"
      pressScale={0.92}
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={{ flex: 1, alignItems: 'center', gap: 2 }}
    >
      <Animated.View style={[{ width: 52, height: 30, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' }, pill]}>
        <Icon name={icon} size={20} color={focused ? 'accentPressed' : 'textTertiary'} />
        {badge > 0 ? (
          <View style={{ position: 'absolute', top: -2, end: 6, minWidth: 17, height: 17, borderRadius: 9, paddingHorizontal: 4, backgroundColor: colors.inverse, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: colors.surface }}>
            <Text variant="micro" color="textInverse" style={{ fontSize: 10, lineHeight: 13 }} ltr>
              {badge > 9 ? '9+' : badge}
            </Text>
          </View>
        ) : null}
      </Animated.View>
      <Text variant="micro" color={focused ? 'text' : 'textTertiary'} weight={focused ? 'semibold' : 'medium'} align="center" numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}
