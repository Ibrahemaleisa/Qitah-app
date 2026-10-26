import {
  IBMPlexSansArabic_400Regular,
  IBMPlexSansArabic_500Medium,
  IBMPlexSansArabic_600SemiBold,
  IBMPlexSansArabic_700Bold,
  useFonts,
} from '@expo-google-fonts/ibm-plex-sans-arabic';
import { IBMPlexMono_400Regular, IBMPlexMono_500Medium } from '@expo-google-fonts/ibm-plex-mono';
import { IBMPlexSans_400Regular, IBMPlexSans_500Medium, IBMPlexSans_600SemiBold, IBMPlexSans_700Bold } from '@expo-google-fonts/ibm-plex-sans';
import { LocaleProvider, Stack, type ErrorBoundaryProps } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { I18nManager, Platform, Pressable, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { BrandSplash } from '@/brand/BrandSplash';
import { isRemote } from '@/config/env';
import { NetworkBanner, RemoteBoot } from '@/features/remote/RemoteBoot';
import { createI18n, useI18n } from '@/i18n';
import { useAppStore } from '@/store/app-store';
import { colors, fonts, radius, space } from '@/theme/tokens';
import { ToastHost } from '@/ui/Toast';

SplashScreen.preventAutoHideAsync().catch(() => {});

// Layout direction is applied per screen (see `Screen`), so explicit left/right must stay literal.
if (Platform.OS !== 'web') {
  I18nManager.allowRTL(true);
  I18nManager.swapLeftAndRightInRTL(false);
}

function useStoreHydrated() {
  return useSyncExternalStore(
    (onChange) => useAppStore.persist.onFinishHydration(onChange),
    () => useAppStore.persist.hasHydrated(),
    () => false,
  );
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
    IBMPlexSans_400Regular,
    IBMPlexSans_500Medium,
    IBMPlexSans_600SemiBold,
    IBMPlexSans_700Bold,
    IBMPlexMono_400Regular,
    IBMPlexMono_500Medium,
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
            <StatusBar style="dark" />
            <BootGate>
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
              <Stack.Screen name="checkout/payment" options={{ gestureEnabled: false }} />
            </Stack>
            </BootGate>
            {isRemote ? <NetworkBanner /> : null}
            <ToastHost />
            {!splashDone ? <BrandSplash onDone={finishSplash} /> : null}
          </View>
        </LocaleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

/** Remote mode waits for the live catalog (skeleton / retry); demo mode renders immediately. */
function BootGate({ children }: { children: React.ReactNode }) {
  return isRemote ? <RemoteBoot>{children}</RemoteBoot> : <>{children}</>;
}

/** Last-resort screen for unexpected render errors: explains, and offers a retry instead of a blank app. */
export function ErrorBoundary({ retry }: ErrorBoundaryProps) {
  const { s, isRTL } = createI18n(useAppStore.getState().lang);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.lg, backgroundColor: colors.background, direction: isRTL ? 'rtl' : 'ltr' }}>
      <Text style={{ fontFamily: fonts.bold, fontSize: 22, lineHeight: 32, color: colors.text, textAlign: 'center' }}>{s.errors.generic}</Text>
      <Pressable
        accessibilityRole="button"
        onPress={retry}
        style={{ backgroundColor: colors.inverse, paddingHorizontal: space.xxl, height: 48, borderRadius: radius.lg, justifyContent: 'center' }}
      >
        <Text style={{ fontFamily: fonts.semibold, fontSize: 15, color: colors.textInverse }}>{s.common.retry}</Text>
      </Pressable>
    </View>
  );
}
