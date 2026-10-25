import { router } from 'expo-router';
import { View } from 'react-native';

import { cities } from '@/data/sellers';
import { deliveryWindow, estimatedTotal, fastestDelivery, getSeller } from '@/domain/pricing';
import type { CityId, DeliveryDestination, Offer } from '@/domain/types';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { RatingInline } from '@/ui/Rating';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

import { ConditionBadge } from './badges';

export type OfferHighlight = 'cheapest' | 'fastest' | 'topRated';

type Props = {
  offer: Offer;
  destination?: DeliveryDestination;
  city?: CityId;
  highlights?: OfferHighlight[];
  compact?: boolean;
};

export function OfferCard({ offer, destination = 'home', city, highlights = [], compact }: Props) {
  const { s, tx, money } = useI18n();
  const addToCart = useAppStore((st) => st.addToCart);
  const inCart = useAppStore((st) => st.cart.find((l) => l.offerId === offer.id)?.qty ?? 0);
  const seller = getSeller(offer.sellerId);
  if (!seller) return null;
  const est = estimatedTotal(offer, destination, city);
  const fastest = fastestDelivery(offer, destination, city);
  const window = fastest ? deliveryWindow(offer, fastest) : null;
  const outOfStock = offer.stock <= 0;
  const atMax = inCart >= Math.min(offer.stock, 10);

  const onAdd = () => {
    addToCart(offer.id);
    haptic.success();
    toast(s.product.added, 'shopping-bag');
  };

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: highlights.includes('cheapest') ? 1.5 : 1, borderColor: highlights.includes('cheapest') ? colors.text : colors.line, padding: space.lg, gap: space.md }}>
      {highlights.length ? (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {highlights.map((h) => (
            <Badge key={h} label={s.product[h]} tone={h === 'cheapest' ? 'accent' : h === 'fastest' ? 'info' : 'success'} icon={h === 'cheapest' ? 'tag' : h === 'fastest' ? 'zap' : 'award'} />
          ))}
        </View>
      ) : null}

      <Pressable onPress={() => router.push(`/seller/${seller.id}`)} pressScale={0.99} accessibilityLabel={tx(seller.name)} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
        <View style={{ width: 36, height: 36, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
          <Text variant="bodyStrong">{tx(seller.name).slice(0, 1)}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Text variant="callout" weight="semibold" numberOfLines={1} style={{ flexShrink: 1 }}>
              {tx(seller.name)}
            </Text>
            {seller.verifiedBusiness ? <Icon name="check-circle" size={13} color="success" /> : null}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
            {seller.rating ? (
              <RatingInline average={seller.rating.average} count={seller.rating.count} />
            ) : (
              <Text variant="caption" color="textTertiary">
                {s.seller.newSeller}
              </Text>
            )}
            <Text variant="caption" color="textTertiary">
              · {tx(cities[seller.city])}
            </Text>
          </View>
        </View>
        <Icon name="chevron-right" size={16} color="textTertiary" />
      </Pressable>

      <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: space.md }}>
        <View style={{ gap: 4 }}>
          <ConditionBadge condition={offer.condition} />
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
            <Text variant="title2" weight="bold">
              {money(offer.price)}
            </Text>
            {offer.compareAtPrice ? (
              <Text variant="caption" color="textTertiary" style={{ textDecorationLine: 'line-through' }}>
                {money(offer.compareAtPrice)}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text variant="micro" color="textTertiary">
            {s.product.estTotal}
          </Text>
          <Text variant="bodyStrong">{est.delivery ? money(est.total) : '—'}</Text>
          <Text variant="micro" color={est.freeShipping ? 'success' : 'textTertiary'}>
            {est.delivery ? (est.freeShipping ? s.product.freeShipping : `+ ${money(est.fee)} ${s.product.shipping}`) : s.product.noWorkshop}
          </Text>
        </View>
      </View>

      {!compact ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md }}>
          <Fact icon="shield" text={s.product.warrantyMonths(offer.warrantyMonths)} />
          <Fact icon="package" text={s.product.dispatchDays(offer.dispatchDays[0], offer.dispatchDays[1])} />
          {window ? <Fact icon="truck" text={s.common.deliveryIn(window[0], window[1])} /> : null}
          {!outOfStock && offer.stock <= 3 ? <Fact icon="alert-circle" text={s.product.onlyLeft(offer.stock)} tone="warning" /> : null}
        </View>
      ) : null}

      {offer.note ? (
        <View style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.sm, padding: space.sm }}>
          <Text variant="caption" color="textSecondary">
            {s.product.sellerNote}: {tx(offer.note)}
          </Text>
        </View>
      ) : null}

      <Button
        label={outOfStock ? s.product.outOfStock : atMax ? s.cart.maxStock : inCart ? `${s.product.addToCart} (${inCart})` : s.product.addToCart}
        icon={outOfStock ? undefined : 'plus'}
        variant={highlights.includes('cheapest') ? 'primary' : 'dark'}
        size="md"
        disabled={outOfStock || atMax}
        onPress={onAdd}
      />
    </View>
  );
}

function Fact({ icon, text, tone }: { icon: 'shield' | 'package' | 'truck' | 'alert-circle'; text: string; tone?: 'warning' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={13} color={tone ?? 'textSecondary'} />
      <Text variant="caption" color={tone ?? 'textSecondary'}>
        {text}
      </Text>
    </View>
  );
}

/** Computes which offers deserve a highlight badge in a comparison list. */
export function offerHighlights(offers: Offer[], destination: DeliveryDestination = 'home', city?: CityId): Record<string, OfferHighlight[]> {
  const inStock = offers.filter((o) => o.stock > 0);
  const result: Record<string, OfferHighlight[]> = {};
  if (inStock.length < 2) return result;
  const push = (id: string | undefined, h: OfferHighlight) => {
    if (!id) return;
    (result[id] ??= []).push(h);
  };
  const byTotal = [...inStock].sort((a, b) => estimatedTotal(a, destination, city).total - estimatedTotal(b, destination, city).total);
  push(byTotal[0]?.id, 'cheapest');
  const speed = (o: Offer) => {
    const f = fastestDelivery(o, destination, city);
    return f ? deliveryWindow(o, f)[1] : 99;
  };
  const bySpeed = [...inStock].sort((a, b) => speed(a) - speed(b));
  if (speed(bySpeed[0]) < speed(bySpeed[1])) push(bySpeed[0].id, 'fastest');
  const rating = (o: Offer) => getSeller(o.sellerId)?.rating?.average ?? 0;
  const byRating = [...inStock].sort((a, b) => rating(b) - rating(a));
  if (rating(byRating[0]) > rating(byRating[1])) push(byRating[0].id, 'topRated');
  return result;
}
