import * as Haptics from 'expo-haptics';
import { Platform } from 'react-native';

/** Thin wrapper so haptics are a no-op on web and never throw. */
export const haptic = {
  tap: () => {
    if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {});
  },
  impact: () => {
    if (Platform.OS !== 'web') Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  },
  success: () => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
  },
  warning: () => {
    if (Platform.OS !== 'web') Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {});
  },
};
