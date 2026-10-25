import { Easing, FadeIn, FadeInDown, FadeInUp, FadeOut, LinearTransition } from 'react-native-reanimated';

import { motion } from './tokens';

/** Brand easing: strong ease-out, cubic-bezier(0.23, 1, 0.32, 1). */
export const brandEasing = Easing.bezier(...motion.bezier);

/** Standard list / content entrance: short upward fade, optionally staggered (capped). */
export function enterUp(index = 0) {
  return FadeInDown.duration(motion.slow).delay(Math.min(index, 6) * 30).easing(brandEasing);
}

export const enterFade = FadeIn.duration(motion.base).easing(brandEasing);
export const exitFade = FadeOut.duration(motion.fast);

/** Layout moves (re-sorting lists) use the same curve and stay within 250ms. */
export const layoutMove = LinearTransition.duration(motion.slow).easing(brandEasing);

export const toastEnter = FadeInUp.duration(motion.base).easing(brandEasing);
