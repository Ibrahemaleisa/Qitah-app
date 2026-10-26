import { useEffect, useState, type ReactNode } from 'react';
import { AppState, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { onConnectivityChange } from '@/api/client';
import { LogoSymbol } from '@/brand/Logo';
import { useRemoteCatalog } from '@/catalog/remote-catalog';
import { useI18n } from '@/i18n';
import { startAccountSync } from '@/services/remote/account';
import { ensureFreshCatalog, hydrateCatalog, loadCachedCatalog, CATALOG_STALE_MS } from '@/services/remote/catalogSync';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';

/**
 * Remote mode bootstrap: shows the cached catalog immediately (if any), refreshes it from the API,
 * keeps it fresh on foreground / every 60s, and starts account sync. Until the first catalog is
 * available it renders a skeleton, or an error state with retry.
 */
export function RemoteBoot({ children }: { children: ReactNode }) {
  const status = useRemoteCatalog((s) => s.status);
  const hasData = useRemoteCatalog((s) => s.products.length > 0);
  const [cacheChecked, setCacheChecked] = useState(false);

  useEffect(() => {
    startAccountSync();
    loadCachedCatalog().finally(() => {
      setCacheChecked(true);
      hydrateCatalog();
    });
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') ensureFreshCatalog();
    });
    const timer = setInterval(() => {
      if (AppState.currentState === 'active') ensureFreshCatalog();
    }, CATALOG_STALE_MS);
    return () => {
      sub.remove();
      clearInterval(timer);
    };
  }, []);

  if (hasData) return <>{children}</>;
  if (!cacheChecked || status === 'idle' || status === 'loading') return <CatalogSkeleton />;
  return <CatalogError />;
}

function CatalogSkeleton() {
  const { s, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <View accessibilityLabel={s.remote.loadingCatalog} accessibilityRole="progressbar" style={{ flex: 1, backgroundColor: colors.background, direction: isRTL ? 'rtl' : 'ltr', paddingTop: insets.top + space.lg, paddingHorizontal: gutter, gap: space.lg }}>
      <Skeleton width={120} height={24} />
      <Skeleton width="70%" height={28} />
      <Skeleton width="100%" height={56} rounded={radius.lg} />
      <Skeleton width="100%" height={96} rounded={radius.lg} />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} width="31%" height={84} rounded={radius.lg} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', gap: space.md }}>
        <Skeleton width={168} height={220} rounded={radius.lg} />
        <Skeleton width={168} height={220} rounded={radius.lg} />
      </View>
      <Text variant="caption" color="textTertiary" align="center">
        {s.remote.loadingCatalog}
      </Text>
    </View>
  );
}

function CatalogError() {
  const { s, isRTL } = useI18n();
  const [busy, setBusy] = useState(false);
  const retry = async () => {
    setBusy(true);
    await hydrateCatalog();
    setBusy(false);
  };
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: space.xxl, gap: space.lg, backgroundColor: colors.background, direction: isRTL ? 'rtl' : 'ltr' }}>
      <LogoSymbol width={96} tone="faint" />
      <Text variant="title2" align="center">
        {s.remote.catalogError}
      </Text>
      <Text variant="body" color="textSecondary" align="center">
        {s.remote.catalogErrorHint}
      </Text>
      <Button label={s.common.retry} icon="refresh-ccw" onPress={retry} loading={busy} style={{ alignSelf: 'stretch' }} />
    </View>
  );
}

/** Floating banner shown while API calls fail with network errors; tap to retry. */
export function NetworkBanner() {
  const { s, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const [offline, setOffline] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => onConnectivityChange((online) => setOffline(!online)), []);
  if (!offline) return null;
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: insets.top + space.xs, left: gutter, right: gutter, direction: isRTL ? 'rtl' : 'ltr' }}>
      <Pressable
        accessibilityRole="alert"
        accessibilityLabel={`${s.remote.offline} ${s.remote.reconnect}`}
        onPress={async () => {
          setBusy(true);
          await hydrateCatalog();
          setBusy(false);
        }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, backgroundColor: colors.inverse, borderRadius: radius.md, paddingVertical: space.sm, paddingHorizontal: space.md }}
      >
        <Icon name="alert-triangle" size={16} color="warning" />
        <Text variant="caption" color="textInverse" style={{ flex: 1 }}>
          {s.remote.offline}
        </Text>
        <Text variant="captionStrong" color="textInverse">
          {busy ? '…' : s.remote.reconnect}
        </Text>
      </Pressable>
    </View>
  );
}
