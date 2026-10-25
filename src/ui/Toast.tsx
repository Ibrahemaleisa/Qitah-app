import { useEffect } from 'react';
import { View } from 'react-native';
import Animated, { FadeInUp, FadeOutUp } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { create } from 'zustand';

import { useI18n } from '@/i18n';
import { colors, radius, shadow, space } from '@/theme/tokens';

import { Icon, type IconName } from './Icon';
import { Text } from './Text';

type ToastState = { message: string | null; icon: IconName; key: number; show: (message: string, icon?: IconName) => void; hide: () => void };

const useToastStore = create<ToastState>()((set) => ({
  message: null,
  icon: 'check',
  key: 0,
  show: (message, icon = 'check') => set((s) => ({ message, icon, key: s.key + 1 })),
  hide: () => set({ message: null }),
}));

export const toast = (message: string, icon?: IconName) => useToastStore.getState().show(message, icon);

export function ToastHost() {
  const { message, icon, key, hide } = useToastStore();
  const { isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(hide, 2200);
    return () => clearTimeout(t);
  }, [message, key, hide]);
  if (!message) return null;
  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: insets.top + space.sm, start: 0, end: 0, alignItems: 'center', direction: isRTL ? 'rtl' : 'ltr' }}>
      <Animated.View
        key={key}
        entering={FadeInUp.springify().damping(18)}
        exiting={FadeOutUp.duration(180)}
        style={[{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.inverse, paddingHorizontal: space.lg, paddingVertical: space.md, borderRadius: radius.pill, maxWidth: '90%' }, shadow.raised]}
      >
        <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={13} color="textOnAccent" />
        </View>
        <Text variant="callout" weight="medium" color="textInverse" numberOfLines={2}>
          {message}
        </Text>
      </Animated.View>
    </View>
  );
}
