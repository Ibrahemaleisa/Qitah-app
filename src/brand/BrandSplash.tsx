import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { FadeOut, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withSequence, withTiming } from 'react-native-reanimated';

import { brandEasing } from '@/theme/motion';
import { colors, fonts, latinFonts, palette } from '@/theme/tokens';
import { Text } from '@/ui/Text';

import { LogoSymbol } from './Logo';
import { SYMBOL_VIEWBOX } from './symbol';

const SYMBOL_W = 132;
const SYMBOL_H = (SYMBOL_W * SYMBOL_VIEWBOX.height) / SYMBOL_VIEWBOX.width;

/**
 * Logo reveal (guidelines p.25), splash only: the car enters and settles (0–250ms), the piece
 * approaches (450ms) and fits into place (650ms), then the name appears (900ms).
 * With Reduce Motion the logo simply fades in.
 */
export function BrandSplash({ onDone }: { onDone: () => void }) {
  const car = useSharedValue(0);
  const piece = useSharedValue(0);
  const word = useSharedValue(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const ease = { easing: brandEasing };
    if (reduceMotion) {
      car.value = withTiming(1, { duration: 200 });
      piece.value = withTiming(2, { duration: 200 });
      word.value = withTiming(1, { duration: 200 });
      const t = setTimeout(onDone, 600);
      return () => clearTimeout(t);
    }
    car.value = withTiming(1, { duration: 250, ...ease });
    // 0 → 1: approach (light, offset) by 450ms; 1 → 2: fits by 650ms.
    piece.value = withDelay(250, withSequence(withTiming(1, { duration: 200, ...ease }), withTiming(2, { duration: 200, ...ease })));
    word.value = withDelay(650, withTiming(1, { duration: 250, ...ease }));
    const t = setTimeout(onDone, 1250);
    return () => clearTimeout(t);
  }, [car, piece, word, onDone, reduceMotion]);

  const carStyle = useAnimatedStyle(() => ({ opacity: 0.35 + car.value * 0.65, transform: [{ translateX: (1 - car.value) * -18 }] }));
  const pieceStyle = useAnimatedStyle(() => {
    const p = piece.value;
    const approach = Math.min(p, 1);
    const fit = Math.max(p - 1, 0);
    return {
      opacity: approach * (0.45 + fit * 0.55),
      transform: [{ translateX: (1 - fit) * 12 }, { translateY: (1 - fit) * 10 }],
    };
  });
  const wordStyle = useAnimatedStyle(() => ({ opacity: word.value, transform: [{ translateY: (1 - word.value) * 6 }] }));

  return (
    <Animated.View exiting={FadeOut.duration(200)} accessible accessibilityLabel="قطعة · Qitah" style={[StyleSheet.absoluteFill, { backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', zIndex: 100 }]}>
      <View style={{ direction: 'ltr', flexDirection: 'row', alignItems: 'center', gap: 22 }}>
        <Animated.View style={wordStyle}>
          <Text style={{ fontFamily: fonts.bold, fontSize: 58, lineHeight: 80, color: palette.qitahBlue }}>قطعة</Text>
        </Animated.View>
        <View style={{ width: SYMBOL_W, height: SYMBOL_H }}>
          <Animated.View style={[StyleSheet.absoluteFill, carStyle]}>
            <LogoSymbol width={SYMBOL_W} layer="car" />
          </Animated.View>
          <Animated.View style={[StyleSheet.absoluteFill, pieceStyle]}>
            <LogoSymbol width={SYMBOL_W} layer="piece" />
          </Animated.View>
        </View>
      </View>
      <Animated.View style={[{ marginTop: 6 }, wordStyle]}>
        <Text style={{ fontFamily: latinFonts.semibold, fontSize: 16, lineHeight: 22, letterSpacing: 1, color: palette.qitahBlue }}>Qitah</Text>
      </Animated.View>
    </Animated.View>
  );
}
