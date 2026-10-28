import { router, useLocalSearchParams } from 'expo-router';
import { Share, View } from 'react-native';

import { isRemote } from '@/config/env';
import { usePollWhileFocused } from '@/features/remote/usePolling';
import ar from '@/i18n/ar';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { cartLinesFor, fetchReview, shareMessage, simulateMechanicApproval, useMechanicReviews } from '@/services/mechanic';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { EmptyState } from '@/ui/EmptyState';
import { Notice } from '@/ui/Notice';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

const STATUS_TONE: Record<string, BadgeTone> = { PENDING: 'info', APPROVED: 'success', CHANGES_SUGGESTED: 'warning', EXPIRED: 'neutral' };

/** The mechanic's answer: per-line decisions, workshop, one tap to the cart, delivery to the workshop. */
export default function MechanicReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, lang, date, time } = useI18n();
  const review = useMechanicReviews((st) => st.byId[id ?? '']);
  const link = useAppStore((st) => (id ? st.mechanicLinks[id] : undefined));
  const addToCart = useAppStore((st) => st.addToCart);
  const user = useAppStore((st) => st.user);

  // Remote: re-read while the screen is open, so the mechanic's answer appears without a manual refresh.
  usePollWhileFocused(
    async () => {
      if (id) await fetchReview(id);
    },
    15_000,
    isRemote && !!user && !!id,
  );

  if (!review) {
    return (
      <Screen header={<ScreenHeader back title={s.mechanic.title} />}>
        {isRemote ? (
          <View style={{ gap: space.md, marginTop: space.lg }}>
            <Skeleton width="100%" height={80} rounded={radius.lg} />
            <Skeleton width="100%" height={120} rounded={radius.lg} />
          </View>
        ) : (
          <EmptyState icon="alert-circle" title={s.errors.notFound} action={{ label: s.errors.goHome, onPress: () => router.replace('/') }} />
        )}
      </Screen>
    );
  }

  const statusKey = review.expired ? 'EXPIRED' : review.status;
  const cartLines = cartLinesFor(review);
  const vehicle = review.vehicle ? `${lang === 'ar' ? review.vehicle.makeAr : review.vehicle.makeEn} ${lang === 'ar' ? review.vehicle.modelAr : review.vehicle.modelEn} ${review.vehicle.year}` : null;
  const responded = review.status !== 'PENDING';

  const addApproved = () => {
    cartLines.forEach((l) => addToCart(l.offerId, l.qty));
    haptic.success();
    toast(s.mechanic.added, 'shopping-bag');
  };

  return (
    <Screen
      header={<ScreenHeader back title={s.mechanic.title} subtitle={vehicle ?? undefined} />}
      footer={
        responded && cartLines.length ? (
          <StickyFooter>
            <Button label={s.mechanic.addApproved(cartLines.length)} icon="shopping-bag" onPress={addApproved} />
          </StickyFooter>
        ) : !responded && link && !review.expired ? (
          <StickyFooter>
            <Button label={s.mechanic.reshare} icon="share" variant="secondary" onPress={() => Share.share({ message: shareMessage(ar, review, link) }).catch(() => {})} />
          </StickyFooter>
        ) : undefined
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, marginTop: space.sm }}>
        <Badge label={s.mechanic.status[statusKey]} tone={STATUS_TONE[statusKey]} />
        {!responded && !review.expired ? (
          <Text variant="caption" color="textTertiary">
            {s.mechanic.validUntil(`${date(new Date(review.expiresAt).getTime())} ${time(new Date(review.expiresAt).getTime())}`)}
          </Text>
        ) : null}
      </View>

      {!isRemote ? (
        <View style={{ marginTop: space.md, gap: space.sm }}>
          <Notice tone="sample" text={s.mechanic.demoNote} />
          {!responded ? <Button label={s.mechanic.simulate} variant="secondary" size="sm" icon="tool" onPress={() => simulateMechanicApproval(review.id, s.mechanic.demoWorkshop)} /> : null}
        </View>
      ) : null}

      {review.workshop || review.mechanicNote ? (
        <View style={{ marginTop: space.lg, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, gap: space.sm }}>
          {review.workshop?.name || review.workshop?.phone ? (
            <View style={{ gap: 2 }}>
              <Text variant="captionStrong" color="textSecondary">
                {s.mechanic.workshop}
              </Text>
              {review.workshop.name ? <Text variant="bodyStrong">{review.workshop.name}</Text> : null}
              {review.workshop.phone ? (
                <Text variant="callout" color="textSecondary" ltr selectable>
                  {review.workshop.phone}
                </Text>
              ) : null}
            </View>
          ) : null}
          {review.mechanicNote ? (
            <View style={{ gap: 2 }}>
              <Text variant="captionStrong" color="textSecondary">
                {s.mechanic.mechanicNote}
              </Text>
              <Text variant="callout">{review.mechanicNote}</Text>
            </View>
          ) : null}
          {responded ? (
            <View style={{ gap: space.xs }}>
              <Button
                label={s.mechanic.deliverToWorkshop}
                variant="secondary"
                size="sm"
                icon="map-pin"
                onPress={() =>
                  router.push({
                    pathname: '/address/edit',
                    params: { kind: 'workshop', ...(review.workshop?.name ? { workshopName: review.workshop.name } : {}), ...(review.workshop?.phone ? { phone: review.workshop.phone } : {}) },
                  })
                }
              />
              <Text variant="caption" color="textTertiary">
                {s.mechanic.deliverToWorkshopHint}
              </Text>
            </View>
          ) : null}
        </View>
      ) : null}

      <Text variant="headline" style={{ marginTop: space.xl, marginBottom: space.sm }}>
        {s.mechanic.parts}
      </Text>
      <View style={{ borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
        {review.lines.map((l, i) => {
          const d = l.decision;
          const altOffer = d?.alternativeOfferId ? l.alternatives.find((a) => a.offerId === d.alternativeOfferId) : undefined;
          return (
            <View key={l.offerId} style={{ padding: space.lg, gap: 4, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: colors.line }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm }}>
                <Text variant="callout" weight="semibold" style={{ flex: 1 }}>
                  {lang === 'ar' ? l.nameAr : l.nameEn} <Text variant="caption" color="textSecondary">× {l.quantity}</Text>
                </Text>
                <Badge label={s.mechanic.decision[d?.decision ?? 'pending']} tone={d?.decision === 'APPROVED' ? 'success' : d ? 'warning' : 'neutral'} />
              </View>
              <Text variant="caption" color="textSecondary" mono>
                {l.brand} · {l.partNumber}
              </Text>
              <View style={{ flexDirection: 'row' }}>
                <Badge label={s.mechanic.fit[l.fit] ?? l.fit} tone={l.fit === 'catalog' ? 'success' : l.fit === 'seller' ? 'warning' : l.fit === 'universal' ? 'info' : 'neutral'} />
              </View>
              {d?.decision === 'ALTERNATIVE' ? (
                <View style={{ marginTop: 4, padding: space.sm, borderRadius: radius.sm, backgroundColor: colors.surfaceMuted, gap: 2 }}>
                  {d.text ? <Text variant="caption">{d.text}</Text> : null}
                  {d.partNumber ? (
                    <Text variant="caption" color="textSecondary">
                      {s.mechanic.altPartNumber}: <Text variant="caption" mono selectable>{d.partNumber}</Text>
                    </Text>
                  ) : null}
                  {altOffer ? (
                    <Text variant="caption" color="textSecondary">
                      {s.mechanic.altOffer} · {lang === 'ar' ? altOffer.sellerAr : altOffer.sellerEn}
                    </Text>
                  ) : (
                    <Text variant="caption" color="textTertiary">
                      {s.mechanic.manualAlternative}
                    </Text>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </Screen>
  );
}
