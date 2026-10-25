import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { Easing, FadeOut, useAnimatedStyle, useSharedValue, withDelay, withSpring, withTiming } from 'react-native-reanimated';

import { colors, palette } from '@/theme/tokens';
import { Text } from '@/ui/Text';

import { LogoMark } from './Logo';

const SIZE = 112;

/**
 * Animated continuation of the native splash: the rotor spins down to rest under the
 * caliper, then the wordmark settles in. Runs once per cold start (~1.3s).
 */
export function BrandSplash({ onDone }: { onDone: () => void }) {
  const spin = useSharedValue(0);
  const caliper = useSharedValue(0);
  const word = useSharedValue(0);

  useEffect(() => {
    spin.value = withTiming(1, { duration: 900, easing: Easing.out(Easing.cubic) });
    caliper.value = withDelay(650, withSpring(1, { damping: 12, stiffness: 240 }));
    word.value = withDelay(750, withTiming(1, { duration: 360 }));
    const t = setTimeout(onDone, 1350);
    return () => clearTimeout(t);
  }, [spin, caliper, word, onDone]);

  const rotor = useAnimatedStyle(() => ({ transform: [{ rotate: `${(1 - spin.value) * -540}deg` }] }));
  const clamp = useAnimatedStyle(() => ({ opacity: caliper.value, transform: [{ scale: 0.86 + caliper.value * 0.14 }] }));
  const wordmark = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: (1 - word.value) * 10 }] }));

  return (
    <Animated.View exiting={FadeOut.duration(260)} style={[StyleSheet.absoluteFill, { backgroundColor: palette.ink900, alignItems: 'center', justifyContent: 'center', zIndex: 100 }]}>
      <View style={{ width: SIZE, height: SIZE }}>
        <Animated.View style={[StyleSheet.absoluteFill, rotor]}>
          <LogoMark size={SIZE} tone="light" layer="rotor" />
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, clamp]}>
          <LogoMark size={SIZE} tone="light" layer="caliper" />
        </Animated.View>
      </View>
      <Animated.View style={[{ marginTop: 22, alignItems: 'center' }, wordmark]}>
        <Text weight="bold" align="center" style={{ fontSize: 40, lineHeight: 56, color: colors.textInverse }}>
          قطعة
        </Text>
        <Text weight="semibold" align="center" style={{ fontSize: 12, lineHeight: 16, letterSpacing: 5, color: palette.ink400 }}>
          QITAH
        </Text>
      </Animated.View>
    </Animated.View>
  );
}
