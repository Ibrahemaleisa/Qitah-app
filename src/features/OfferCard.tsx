import { router } from 'expo-router';
import { View } from 'react-native';

import { cities } from '@/data/sellers';
import type { OfferHighlight } from '@/domain/offerComparison';
import { deliveryWindow, estimatedTotal, fastestDelivery, getSeller } from '@/domain/pricing';
import type { CityId, DeliveryDestination, Offer } from '@/domain/types';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Icon, type IconName } from '@/ui/Icon';
import { Pressable } from '@/ui/Pressable';
import { RatingInline } from '@/ui/Rating';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

import { ConditionBadge } from './badges';

export { offerHighlights, type OfferHighlight } from '@/domain/offerComparison';

type Props = {
  offer: Offer;
  destination?: DeliveryDestination;
  city?: CityId;
  highlights?: OfferHighlight[];
};

const highlightVisuals = {
  cheapest: { tone: 'accent', icon: 'tag' },
  fastest: { tone: 'info', icon: 'zap' },
  topRated: { tone: 'success', icon: 'award' },
} as const;

/**
 * One seller's offer. The price breakdown keeps part price, delivery fee and total on separate
 * lines so offers can be compared at a glance without mental arithmetic.
 */
export function OfferCard({ offer, destination = 'home', city, highlights = [] }: Props) {
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
  const featured = highlights.some((h) => h.kind === 'cheapest');
  const deliveryText = !est.delivery ? s.product.deliveryUnavailableWorkshop : est.freeShipping ? s.product.freeShipping : money(est.fee);

  const onAdd = () => {
    addToCart(offer.id);
    haptic.success();
    toast(s.product.added, 'shopping-bag');
  };

  return (
    <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: featured ? 1.5 : 1, borderColor: featured ? colors.text : colors.line, padding: space.lg, gap: space.md, opacity: outOfStock ? 0.7 : 1 }}>
      {highlights.length ? (
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          {highlights.map((h) => (
            <Badge key={h.kind} label={h.condition ? `${s.product[h.kind]} · ${s.condition[h.condition]}` : s.product[h.kind]} {...highlightVisuals[h.kind]} />
          ))}
        </View>
      ) : null}

      <Pressable
        onPress={() => router.push(`/seller/${seller.id}`)}
        pressScale={0.99}
        accessibilityRole="link"
        accessibilityLabel={`${tx(seller.name)}${seller.rating ? `, ${seller.rating.average.toFixed(1)} ★` : ''}`}
        accessibilityHint={s.product.viewSeller}
        style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, minHeight: 44 }}
      >
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
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, flexWrap: 'wrap' }}>
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

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: space.sm }}>
        <ConditionBadge condition={offer.condition} />
        <Fact icon="shield" text={s.product.warrantyMonths(offer.warrantyMonths)} />
        {window ? <Fact icon="truck" text={s.common.deliveryIn(window[0], window[1])} /> : null}
        {!outOfStock && offer.stock <= 3 ? <Fact icon="alert-circle" text={s.product.onlyLeft(offer.stock)} tone="warning" /> : null}
      </View>

      <View accessible accessibilityLabel={`${s.product.partPrice} ${money(offer.price)}, ${s.product.deliveryFee} ${deliveryText}, ${s.product.total} ${est.delivery ? money(est.total) : '—'}`} style={{ backgroundColor: colors.surfaceMuted, borderRadius: radius.md, padding: space.md, gap: 6 }}>
        <Line label={s.product.partPrice}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: space.sm }}>
            {offer.compareAtPrice ? (
              <Text variant="caption" color="textTertiary" style={{ textDecorationLine: 'line-through' }}>
                {money(offer.compareAtPrice)}
              </Text>
            ) : null}
            <Text variant="callout" weight="semibold">
              {money(offer.price)}
            </Text>
          </View>
        </Line>
        <Line label={s.product.deliveryFee}>
          <Text variant="callout" weight="semibold" color={!est.delivery ? 'danger' : est.freeShipping ? 'success' : 'text'}>
            {deliveryText}
          </Text>
        </Line>
        <View style={{ height: 1, backgroundColor: colors.line }} />
        <Line label={s.product.total} strong>
          <Text variant="headline" weight="bold">
            {est.delivery ? money(est.total) : '—'}
          </Text>
        </Line>
      </View>

      {offer.note ? (
        <Text variant="caption" color="textSecondary">
          {s.product.sellerNote}: {tx(offer.note)}
        </Text>
      ) : null}

      <Button
        label={outOfStock ? s.product.outOfStock : atMax ? s.cart.maxStock : inCart ? `${s.product.addToCart} (${inCart})` : s.product.addToCart}
        icon={outOfStock || atMax ? undefined : 'plus'}
        variant={featured ? 'primary' : 'dark'}
        size="md"
        disabled={outOfStock || atMax}
        accessibilityHint={`${s.condition[offer.condition]} · ${tx(seller.name)}`}
        onPress={onAdd}
      />
    </View>
  );
}

function Line({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.md }}>
      <Text variant={strong ? 'bodyStrong' : 'caption'} color={strong ? 'text' : 'textSecondary'}>
        {label}
      </Text>
      {children}
    </View>
  );
}

function Fact({ icon, text, tone }: { icon: IconName; text: string; tone?: 'warning' }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name={icon} size={13} color={tone ?? 'textSecondary'} />
      <Text variant="caption" color={tone ?? 'textSecondary'}>
        {text}
      </Text>
    </View>
  );
}
