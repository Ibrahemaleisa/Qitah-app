import { router } from 'expo-router';
import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useI18n } from '@/i18n';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { IconButton } from '@/ui/IconButton';
import { Screen } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';

/** Placeholder for a product screen while its product is fetched into the remote cache. */
export function ProductSkeleton() {
  const { s } = useI18n();
  const insets = useSafeAreaInsets();
  return (
    <Screen padded={false}>
      <View accessibilityRole="progressbar" accessibilityLabel={s.remote.loadingCatalog} style={{ height: 270 + insets.top, paddingTop: insets.top, backgroundColor: colors.surfaceSunken }}>
        <View style={{ padding: gutter }}>
          <IconButton icon="chevron-left" label={s.common.back} onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        </View>
      </View>
      <View style={{ padding: gutter, gap: space.md }}>
        <Skeleton width="40%" height={16} />
        <Skeleton width="85%" height={28} />
        <Skeleton width="60%" height={18} />
        <Skeleton width="100%" height={120} rounded={radius.lg} />
        <Skeleton width="100%" height={96} rounded={radius.lg} />
      </View>
    </Screen>
  );
}
