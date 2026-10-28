import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import Animated from 'react-native-reanimated';

import { canAccept, type ConditionPreference, type OriginPreference, type PartRequestStatus, type PartRequestSummary } from '@/api/partRequests';
import { isRemote } from '@/config/env';
import { cities, cityIds, cityLabel } from '@/data/sellers';
import type { CityId, Vehicle } from '@/domain/types';
import { QuoteCard } from '@/features/QuoteCard';
import { useI18n } from '@/i18n';
import type { Strings } from '@/i18n/ar';
import { apiErrorCode, apiErrorMessage } from '@/lib/api-errors';
import { confirmAction } from '@/lib/confirm';
import { haptic } from '@/lib/haptics';
import { useNow } from '@/lib/use-now';
import { vehicleLabel } from '@/lib/vehicle';
import { acceptQuote, cancelPartRequest, createPartRequest, fetchPartRequest, fetchPartRequests, MAX_PHOTOS, usePartRequests, type LocalPhoto } from '@/services/remote/partRequests';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { enterUp } from '@/theme/motion';
import { colors, radius, space } from '@/theme/tokens';
import { Badge, type BadgeTone } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { IconButton } from '@/ui/IconButton';
import { Input } from '@/ui/Input';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Segmented } from '@/ui/Segmented';
import { Skeleton } from '@/ui/Skeleton';
import { Stepper } from '@/ui/Stepper';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

import { usePollWhileFocused } from './usePolling';

/** Localized message for part-request failures (falls back to the generic API messages). */
export function partRequestError(s: Strings, e: unknown): string {
  return s.partRequest.errors[apiErrorCode(e)] ?? apiErrorMessage(s, e);
}

export const requestStatusTone: Record<PartRequestStatus, BadgeTone> = { open: 'warning', quoted: 'info', accepted: 'success', expired: 'neutral', cancelled: 'neutral' };

/** Guard shared by the three screens: remote mode + signed in. */
function useGate(title: string) {
  const { s } = useI18n();
  const user = useAppStore((st) => st.user);
  if (!isRemote) {
    return (
      <Screen header={<ScreenHeader back title={title} />}>
        <EmptyState icon="message-square" title={title} body={s.partRequest.remoteOnly} />
      </Screen>
    );
  }
  if (!user) {
    return (
      <Screen header={<ScreenHeader back title={title} />}>
        <EmptyState icon="message-square" title={title} body={s.partRequest.signIn} action={{ label: s.common.signIn, onPress: () => router.push('/sign-in') }} />
      </Screen>
    );
  }
  return null;
}

// ───────────────────────────────────────────── new request

/** Part numbers are short codes with digits (e.g. 04465-33450); anything else is treated as a description. */
const looksLikePartNumber = (q: string) => /\d/.test(q) && /^[A-Za-z0-9\- .]{4,30}$/.test(q.trim());

export function NewPartRequestScreen() {
  const { s, tx, lang } = useI18n();
  const params = useLocalSearchParams<{ q?: string }>();
  const initial = (params.q ?? '').trim();
  const vehicles = useAppStore((st) => st.vehicles);
  const addresses = useAppStore((st) => st.addresses);
  const selected = useSelectedVehicle();
  const [vehicleId, setVehicleId] = useState<string | undefined>(selected?.id ?? vehicles[0]?.id);
  const [description, setDescription] = useState(looksLikePartNumber(initial) ? '' : initial);
  const [partNumber, setPartNumber] = useState(looksLikePartNumber(initial) ? initial : '');
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [condition, setCondition] = useState<ConditionPreference>('any');
  const [origin, setOrigin] = useState<OriginPreference>('any');
  const [addressId, setAddressId] = useState<string | undefined>(addresses[0]?.id);
  const [city, setCity] = useState<CityId>('riyadh');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const gate = useGate(s.partRequest.newTitle);
  if (gate) return gate;

  const vehicle: Vehicle | undefined = vehicles.find((v) => v.id === vehicleId);
  const address = addresses.find((a) => a.id === addressId);

  const pickPhotos = async () => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length });
      if (res.canceled) return;
      setPhotos((p) => [...p, ...res.assets.map((a) => ({ uri: a.uri, mimeType: a.mimeType, fileSize: a.fileSize, fileName: a.fileName }))].slice(0, MAX_PHOTOS));
    } catch {
      toast(s.partRequest.photoPermission, 'alert-circle');
    }
  };

  const submit = async () => {
    if (!vehicle) return;
    if (!description.trim() && !partNumber.trim() && !photos.length) {
      setError(s.partRequest.needDescription);
      haptic.warning();
      return;
    }
    setError(null);
    setBusy(photos.length ? s.partRequest.uploading(1, photos.length) : s.partRequest.submit);
    try {
      // Garage vehicles synced to the account are referenced by id; a guest-only vehicle is sent by model.
      const serverVehicle = !/^veh-/.test(vehicle.id);
      const created = await createPartRequest({
        ...(serverVehicle ? { vehicleId: vehicle.id } : { vehicle: { modelId: vehicle.modelId, year: vehicle.year, engine: vehicle.engine, ...(vehicle.vin ? { vin: vehicle.vin } : {}) } }),
        description: description.trim(),
        ...(partNumber.trim() ? { partNumber: partNumber.trim() } : {}),
        quantity,
        preferredCondition: condition.toUpperCase() as 'ANY' | 'NEW' | 'USED',
        preferredOrigin: origin.toUpperCase() as 'ANY' | 'OEM' | 'AFTERMARKET',
        ...(address && !/^addr-/.test(address.id) ? { addressId: address.id } : { city: address?.city ?? city }),
        photos,
      });
      haptic.success();
      toast(s.partRequest.sent, 'check-circle');
      router.replace(`/part-requests/${created.id}`);
    } catch (e) {
      haptic.warning();
      setError(partRequestError(s, e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        header={<ScreenHeader back title={s.partRequest.newTitle} subtitle={s.partRequest.newSubtitle} />}
        footer={
          <StickyFooter>
            {error ? <Notice tone="danger" text={error} /> : null}
            <Button label={busy ?? s.partRequest.submit} icon="message-square" loading={!!busy} disabled={!vehicle} onPress={submit} />
          </StickyFooter>
        }
      >
        <View style={{ gap: space.xl, marginTop: space.md }}>
          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.partRequest.vehicle}
            </Text>
            {vehicles.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {vehicles.map((v) => (
                  <Chip key={v.id} label={vehicleLabel(v, lang)} icon="car" selected={v.id === vehicleId} onPress={() => setVehicleId(v.id)} />
                ))}
                <Chip label={s.partRequest.addVehicle} icon="plus" onPress={() => router.push('/garage/add')} />
              </View>
            ) : (
              <View style={{ gap: space.sm }}>
                <Notice tone="warning" text={s.partRequest.noVehicle} />
                <Button label={s.partRequest.addVehicle} icon="car" variant="secondary" size="md" onPress={() => router.push('/garage/add')} />
              </View>
            )}
          </View>

          <Input label={s.partRequest.description} placeholder={s.partRequest.descriptionPlaceholder} value={description} onChangeText={setDescription} multiline maxLength={1000} style={{ minHeight: 88, textAlignVertical: 'top', paddingVertical: space.md }} />
          <Input label={`${s.partRequest.partNumber} (${s.common.optional})`} placeholder={s.partRequest.partNumberPlaceholder} value={partNumber} onChangeText={setPartNumber} autoCapitalize="characters" maxLength={60} ltr />

          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.partRequest.photos}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {photos.map((p, i) => (
                <View key={p.uri} style={{ width: 88, height: 88 }}>
                  <Image source={{ uri: p.uri }} style={{ width: 88, height: 88, borderRadius: radius.md, backgroundColor: colors.surfaceSunken }} contentFit="cover" accessibilityLabel={`${s.partRequest.photos} ${i + 1}`} />
                  <View style={{ position: 'absolute', top: 2, right: 2 }}>
                    <IconButton icon="x" size={28} label={s.partRequest.removePhoto} onPress={() => setPhotos((all) => all.filter((x) => x.uri !== p.uri))} />
                  </View>
                </View>
              ))}
              {photos.length < MAX_PHOTOS ? (
                <Pressable
                  onPress={pickPhotos}
                  accessibilityRole="button"
                  accessibilityLabel={s.partRequest.addPhoto}
                  style={{ width: 88, height: 88, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', gap: 2, backgroundColor: colors.surface }}
                >
                  <Icon name="plus" size={20} color="textSecondary" />
                  <Text variant="caption" color="textSecondary">
                    {s.partRequest.addPhoto}
                  </Text>
                </Pressable>
              ) : null}
            </View>
            <Text variant="caption" color="textTertiary">
              {s.partRequest.photosHint(MAX_PHOTOS)}
            </Text>
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.partRequest.quantity}
            </Text>
            <Stepper value={quantity} onChange={setQuantity} min={1} max={20} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.partRequest.condition}
            </Text>
            <Segmented value={condition} onChange={setCondition} options={(['any', 'new', 'used'] as const).map((v) => ({ value: v, label: s.partRequest.conditionOptions[v] }))} />
          </View>
          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.partRequest.origin}
            </Text>
            <Segmented value={origin} onChange={setOrigin} options={(['any', 'oem', 'aftermarket'] as const).map((v) => ({ value: v, label: s.partRequest.originOptions[v] }))} />
          </View>

          <View style={{ gap: space.sm }}>
            <Text variant="captionStrong" color="textSecondary">
              {s.partRequest.deliverTo}
            </Text>
            {addresses.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {addresses.map((a) => (
                  <Chip key={a.id} label={`${a.label} · ${tx(cityLabel(a.city))}`} icon={a.kind === 'workshop' ? 'tool' : 'home'} selected={a.id === addressId} onPress={() => setAddressId(a.id)} />
                ))}
              </View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {cityIds.map((c) => (
                  <Chip key={c} label={tx(cities[c])} selected={city === c} onPress={() => setCity(c)} />
                ))}
              </View>
            )}
          </View>

          <Notice tone="info" icon="lock" text={s.partRequest.privacyNote} />
        </View>
      </Screen>
    </KeyboardAvoidingView>
  );
}

// ───────────────────────────────────────────── my requests

export function PartRequestListScreen() {
  const { s } = useI18n();
  const list = usePartRequests((st) => st.list);
  const listState = usePartRequests((st) => st.listState);
  const user = useAppStore((st) => st.user);
  usePollWhileFocused(() => (isRemote && user ? fetchPartRequests() : undefined), 20_000, isRemote && !!user);
  const gate = useGate(s.partRequest.listTitle);
  if (gate) return gate;

  return (
    <Screen
      header={<ScreenHeader back title={s.partRequest.listTitle} right={<IconButton icon="plus" label={s.partRequest.newRequest} onPress={() => router.push('/part-requests/new')} />} />}
    >
      {listState === 'loading' && !list.length ? (
        <View style={{ gap: space.md, marginTop: space.md }}>
          {[0, 1].map((i) => (
            <Skeleton key={i} width="100%" height={120} rounded={radius.lg} />
          ))}
        </View>
      ) : listState === 'error' && !list.length ? (
        <View style={{ gap: space.md, marginTop: space.md }}>
          <Notice tone="danger" text={s.remote.loadFailed} />
          <Button label={s.common.retry} icon="refresh-ccw" variant="secondary" onPress={() => fetchPartRequests().catch(() => {})} />
        </View>
      ) : list.length === 0 ? (
        <EmptyState icon="message-square" title={s.partRequest.listEmpty} body={s.partRequest.listEmptyHint} action={{ label: s.partRequest.homeCta, onPress: () => router.push('/part-requests/new') }} />
      ) : (
        <View style={{ gap: space.md, marginTop: space.md }}>
          {list.map((r, i) => (
            <Animated.View key={r.id} entering={enterUp(i)}>
              <RequestRow request={r} />
            </Animated.View>
          ))}
        </View>
      )}
    </Screen>
  );
}

function RequestRow({ request: r }: { request: PartRequestSummary }) {
  const { s, tx, money, date } = useI18n();
  return (
    <Pressable
      onPress={() => router.push(`/part-requests/${r.id}`)}
      pressScale={0.985}
      accessibilityLabel={`${tx(r.vehicleLabel)}, ${s.partRequest.status[r.status]}, ${s.partRequest.quotes(r.quoteCount)}`}
      style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: r.status === 'quoted' ? colors.primary : colors.line, padding: space.lg, gap: space.sm }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
        <Text variant="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>
          {tx(r.vehicleLabel)}
        </Text>
        <Badge label={s.partRequest.status[r.status]} tone={requestStatusTone[r.status]} />
      </View>
      <Text variant="callout" color="textSecondary" numberOfLines={2}>
        {r.description || r.partNumber || '—'}
      </Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="caption" color="textTertiary">
          <Text variant="caption" color="textTertiary" ltr>
            {r.number}
          </Text>{' '}
          · {date(r.createdAt)}
        </Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Text variant="captionStrong" color={r.quoteCount ? 'link' : 'textSecondary'}>
            {r.bestPrice != null ? s.partRequest.bestPrice(money(r.bestPrice)) : s.partRequest.quotes(r.quoteCount)}
          </Text>
          <Icon name="chevron-right" size={16} color="textTertiary" />
        </View>
      </View>
    </Pressable>
  );
}

// ───────────────────────────────────────────── request detail

export function PartRequestDetailScreen() {
  const { s, tx, date } = useI18n();
  const { id } = useLocalSearchParams<{ id: string }>();
  const detail = usePartRequests((st) => (id ? st.byId[id] : undefined));
  const user = useAppStore((st) => st.user);
  const now = useNow(30_000);
  const [loadError, setLoadError] = useState(false);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  usePollWhileFocused(
    () =>
      id && isRemote && user
        ? fetchPartRequest(id).then(
            () => setLoadError(false),
            () => setLoadError(true),
          )
        : undefined,
    15_000,
    isRemote && !!user && !!id,
  );
  const cheapestId = useMemo(() => {
    if (!detail) return undefined;
    const live = detail.quotes.filter((q) => canAccept(detail, q, now));
    return live.length > 1 ? live.reduce((a, b) => (b.price < a.price ? b : a)).id : undefined;
  }, [detail, now]);
  const gate = useGate(s.partRequest.yourRequest);
  if (gate) return gate;

  if (!detail) {
    return (
      <Screen header={<ScreenHeader back title={s.partRequest.yourRequest} />}>
        {loadError ? (
          <View style={{ gap: space.md, marginTop: space.md }}>
            <Notice tone="danger" text={s.remote.loadFailed} />
            <Button label={s.common.retry} icon="refresh-ccw" variant="secondary" onPress={() => id && fetchPartRequest(id).catch(() => setLoadError(true))} />
          </View>
        ) : (
          <View style={{ gap: space.md, marginTop: space.md }}>
            <Skeleton width="100%" height={160} rounded={radius.lg} />
            <Skeleton width="100%" height={220} rounded={radius.lg} />
          </View>
        )}
      </Screen>
    );
  }

  const open = detail.status === 'open' || detail.status === 'quoted';
  const accepted = detail.quotes.find((q) => q.status === 'accepted');

  const accept = async (quoteId: string) => {
    setAccepting(quoteId);
    try {
      await acceptQuote(detail.id, quoteId);
      haptic.success();
      toast(s.partRequest.acceptedToast, 'shopping-bag');
      router.navigate('/cart');
    } catch (e) {
      haptic.warning();
      toast(partRequestError(s, e), 'alert-circle');
      fetchPartRequest(detail.id).catch(() => {});
    } finally {
      setAccepting(null);
    }
  };

  const cancel = () =>
    confirmAction(s.partRequest.cancelConfirm, s.partRequest.cancel, s.common.cancel, async () => {
      setCancelling(true);
      try {
        await cancelPartRequest(detail.id);
        toast(s.partRequest.cancelled, 'check-circle');
      } catch (e) {
        toast(partRequestError(s, e), 'alert-circle');
      } finally {
        setCancelling(false);
      }
    });

  return (
    <Screen
      header={<ScreenHeader back title={s.partRequest.yourRequest} subtitle={detail.number} />}
      footer={
        accepted ? (
          <StickyFooter>
            <Button label={s.partRequest.goToCart} icon="shopping-bag" onPress={() => router.navigate('/cart')} />
          </StickyFooter>
        ) : undefined
      }
    >
      <View style={{ gap: space.lg, marginTop: space.sm }}>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, padding: space.lg, gap: space.sm }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space.sm }}>
            <Text variant="headline" style={{ flex: 1 }}>
              {tx(detail.vehicleLabel)}
            </Text>
            <Badge label={s.partRequest.status[detail.status]} tone={requestStatusTone[detail.status]} />
          </View>
          {detail.description ? <Text variant="body">{detail.description}</Text> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {detail.partNumber ? <Badge label={detail.partNumber} icon="hash" /> : null}
            {detail.quantity > 1 ? <Badge label={s.partRequest.quantityShort(detail.quantity)} /> : null}
            <Badge label={s.partRequest.conditionOptions[detail.preferredCondition]} />
            <Badge label={s.partRequest.originOptions[detail.preferredOrigin]} />
            {detail.city ? <Badge label={tx(cityLabel(detail.city))} icon="map-pin" /> : null}
          </View>
          {detail.photos.length ? (
            <View style={{ flexDirection: 'row', gap: space.sm }}>
              {detail.photos.map((url, i) => (
                <Image key={url} source={{ uri: url }} style={{ width: 72, height: 72, borderRadius: radius.sm, backgroundColor: colors.surfaceSunken }} contentFit="cover" accessibilityLabel={`${s.partRequest.photos} ${i + 1}`} />
              ))}
            </View>
          ) : null}
          <Text variant="caption" color="textTertiary">
            {date(detail.createdAt)}
            {open ? ` · ${s.partRequest.expiresIn(Math.max(0, Math.floor((detail.expiresAt - now) / 3_600_000)))}` : ''}
          </Text>
        </View>

        <Text variant="title2" accessibilityRole="header">
          {s.partRequest.quotesTitle}
          {detail.quoteCount ? ` · ${s.partRequest.quotes(detail.quoteCount)}` : ''}
        </Text>
        {detail.quotes.length === 0 ? (
          open ? (
            <Notice tone="info" icon="clock" text={s.partRequest.waitingQuotes} />
          ) : (
            <Text variant="callout" color="textSecondary">
              {s.partRequest.noQuotesYet}
            </Text>
          )
        ) : (
          detail.quotes.map((q, i) => (
            <Animated.View key={q.id} entering={enterUp(i)}>
              <QuoteCard quote={q} now={now} cheapest={q.id === cheapestId} canAccept={canAccept(detail, q, now) && !accepting} accepting={accepting === q.id} onAccept={() => accept(q.id)} />
            </Animated.View>
          ))
        )}
        {open ? <Button label={s.partRequest.cancel} variant="danger" size="md" loading={cancelling} onPress={cancel} /> : null}
      </View>
    </Screen>
  );
}
