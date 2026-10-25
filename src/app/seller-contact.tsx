import { router, useLocalSearchParams } from 'expo-router';
import { View } from 'react-native';

import { getSeller } from '@/domain/pricing';
import { useI18n } from '@/i18n';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Notice } from '@/ui/Notice';
import { Text } from '@/ui/Text';

/** Entry point for buyer–seller messaging (chat itself ships in a later milestone). */
export default function SellerContactSheet() {
  const { sellerId, orderNumber } = useLocalSearchParams<{ sellerId: string; orderNumber?: string }>();
  const { s, tx, isRTL } = useI18n();
  const seller = getSeller(sellerId ?? '');
  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background, paddingHorizontal: gutter, paddingTop: space.xl, gap: space.lg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: 48, height: 48, borderRadius: radius.md, backgroundColor: colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="message-circle" size={22} color="accentPressed" />
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="title2">{s.seller.contact}</Text>
          <Text variant="callout" color="textSecondary">
            {seller ? tx(seller.name) : ''}
            {orderNumber ? ` · ${orderNumber}` : ''}
          </Text>
        </View>
      </View>
      {seller ? (
        <Text variant="callout" color="textSecondary">
          {s.seller.responds(seller.responseHours)}
        </Text>
      ) : null}
      <Notice tone="info" text={s.seller.contactSimulated} />
      <Button label={s.common.close} variant="dark" onPress={() => router.back()} />
    </View>
  );
}
