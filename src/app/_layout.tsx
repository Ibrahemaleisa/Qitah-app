import Feather from '@expo/vector-icons/Feather';
import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { LocaleProvider, Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState } from 'react';
import { I18nManager, Platform, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandSplash } from '@/brand/BrandSplash';
import { useI18n } from '@/i18n';
import { useAppStore } from '@/store/app-store';
import { colors } from '@/theme/tokens';
import { ToastHost } from '@/ui/Toast';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Layout direction is applied per screen (see `Screen`), so explicit left/right must stay literal.
if (Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.swapLeftAndRightInRTL(false);
}

function useStoreHydrated() {
  const [hydrated, setHydrated] = useState(() => useAppStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    const unsub = useAppStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAppStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, [hydrated]);
  return hydrated;
}

const sheet = (detents: number[] | 'fitToContents' = [0.62, 0.95]) =>
  ({
    presentation: 'formSheet',
    sheetAllowedDetents: detents,
    sheetGrabberVisible: true,
    sheetCornerRadius: 28,
    contentStyle: { backgroundColor: colors.background },
  }) as const;

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    IBMPlexSansArabic_400Regular,
    IBMPlexSansArabic_500Medium,
    IBMPlexSansArabic_600SemiBold,
    IBMPlexSansArabic_700Bold,
    ...Feather.font,
  });
  const hydrated = useStoreHydrated();
  const ready = (fontsLoaded || !!fontError) && hydrated;
  const [splashDone, setSplashDone] = useState(false);
  const { isRTL, lang } = useI18n();
  const ensureSampleOrder = useAppStore((s) => s.ensureSampleOrder);

  useEffect(() => {
    if (!ready) return;
    SplashScreen.hideAsync().catch(() => {});
    ensureSampleOrder();
  }, [ready, ensureSampleOrder]);

  // Keep native chrome (navigation gestures, system controls) in sync for the next launch,
  // and mirror the document direction on web.
  useEffect(() => {
    if (Platform.OS === 'web') {
      if (typeof document !== 'undefined') {
        document.documentElement.dir = isRTL ? 'rtl' : 'ltr';
        document.documentElement.lang = lang;
      }
      return;
    }
    if (I18nManager.isRTL !== isRTL) I18nManager.forceRTL(isRTL);
  }, [isRTL, lang]);

  const finishSplash = useCallback(() => setSplashDone(true), []);

  if (!ready) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LocaleProvider direction={isRTL ? 'rtl' : 'ltr'}>
          <View style={{ flex: 1, backgroundColor: colors.background, direction: isRTL ? 'rtl' : 'ltr' }}>
            <StatusBar style={splashDone ? 'dark' : 'light'} />
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="onboarding" options={{ animation: 'fade', gestureEnabled: false }} />
              <Stack.Screen name="sign-in" options={{ presentation: 'modal' }} />
              <Stack.Screen name="garage/add" options={{ presentation: 'modal' }} />
              <Stack.Screen name="address/edit" options={{ presentation: 'modal' }} />
              <Stack.Screen name="vehicle-switcher" options={sheet()} />
              <Stack.Screen name="search-filters" options={sheet([0.8, 0.98])} />
              <Stack.Screen name="search-sort" options={sheet([0.5])} />
              <Stack.Screen name="order/cancel" options={sheet([0.7])} />
              <Stack.Screen name="order/return" options={sheet([0.85])} />
              <Stack.Screen name="seller-contact" options={sheet([0.45])} />
              <Stack.Screen name="checkout/success" options={{ gestureEnabled: false, animation: 'fade' }} />
            </Stack>
            <ToastHost />
            {!splashDone ? <BrandSplash onDone={finishSplash} /> : null}
          </View>
        </LocaleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
