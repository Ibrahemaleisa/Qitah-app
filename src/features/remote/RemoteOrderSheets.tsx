import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { ScrollView, View } from 'react-native';

import { toApiError } from '@/api/client';
import { PartArt } from '@/brand/PartArt';
import type { ReturnReason } from '@/domain/types';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { RETURN_WINDOW_DAYS } from '@/services/remote/orderView';
import { cancelOrder, requestReturn, useRemoteOrder } from '@/services/remote/orders';
import { uploadReturnPhoto } from '@/services/remote/uploads';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { Input } from '@/ui/Input';
import { Notice } from '@/ui/Notice';
import { Icon } from '@/ui/Icon';
import { IconButton } from '@/ui/IconButton';
import { Pressable } from '@/ui/Pressable';
import { Stepper } from '@/ui/Stepper';
import { Text } from '@/ui/Text';
import { Toggle } from '@/ui/Toggle';
import { toast } from '@/ui/Toast';

const MAX_PHOTOS = 6;

const REASONS: ReturnReason[] = ['wrongPart', 'damaged', 'notAsDescribed', 'changedMind'];

/** Remote cancel: `POST /v1/orders/:id/cancel`. Refunds (if paid) are issued by the server. */
export function RemoteCancelSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { s, isRTL } = useI18n();
  const { order } = useRemoteOrder(id);
  const [reason, setReason] = useState<string>();
  const [busy, setBusy] = useState(false);
  const allowed = !!order?.canCancel;

  const confirm = async () => {
    if (!order || !reason) return;
    setBusy(true);
    try {
      await cancelOrder(order.id, reason);
      haptic.success();
      toast(s.orders.cancelled, 'x-circle');
      router.back();
    } catch (e) {
      setBusy(false);
      haptic.warning();
      toast(apiErrorMessage(s, e), 'alert-circle');
    }
  };

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.xxl, gap: space.md }}>
        <Text variant="title2">{s.orders.cancelTitle}</Text>
        <Text variant="callout" color="textSecondary">
          {s.remote.cancelBody}
        </Text>
        {order && !allowed ? <Notice tone="warning" text={s.remote.errors.NOT_CANCELLABLE} /> : null}
        {s.orders.cancelReasons.map((r) => (
          <ChoiceRow key={r} title={r} selected={reason === r} onPress={() => setReason(r)} disabled={!allowed} />
        ))}
        <Button label={s.orders.confirmCancel} variant="danger" onPress={confirm} disabled={!reason || !allowed} loading={busy} style={{ marginTop: space.sm }} />
        <Button label={s.common.close} variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}

/** Remote return: choose items + quantities, a reason and an optional note → `POST /v1/orders/:id/returns`. */
export function RemoteReturnSheet() {
  const { id, shipmentId } = useLocalSearchParams<{ id: string; shipmentId?: string }>();
  const { s, tx, isRTL } = useI18n();
  const { order } = useRemoteOrder(id);
  const shipment = order?.shipments.find((sh) => sh.groupId === shipmentId);
  const eligible = (order?.returnable ?? []).filter((r) => !shipment || shipment.items.some((i) => i.id === r.itemId));
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason>();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [photos, setPhotos] = useState<{ key: string; uri: string }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [unopened, setUnopened] = useState(false);
  // With a single returnable item, start at quantity 1 so the sheet is one tap shorter.
  const qtyOf = (itemId: string) => qty[itemId] ?? (eligible.length === 1 ? 1 : 0);
  const selected = eligible.filter((r) => qtyOf(r.itemId) > 0);
  // A wrong-part claim is covered when every selected line was guaranteed by the server at checkout.
  const allGuaranteed = selected.length > 0 && selected.every((r) => order?.items.find((i) => i.id === r.itemId)?.guaranteed);
  const hint = reason === 'wrongPart' ? (allGuaranteed ? s.trust.reasonHint.wrongPartGuaranteed : s.trust.reasonHint.wrongPart) : reason ? s.trust.reasonHint[reason] : undefined;
  const needsPhoto = reason === 'damaged' && photos.length === 0;
  const needsUnopened = reason === 'changedMind' && !unopened;

  const addPhotos = async () => {
    let picked: ImagePicker.ImagePickerResult;
    try {
      picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.7, allowsMultipleSelection: true, selectionLimit: MAX_PHOTOS - photos.length });
    } catch {
      toast(s.trust.photoPermission, 'alert-circle');
      return;
    }
    if (picked.canceled) return;
    setUploading(true);
    try {
      for (const asset of picked.assets.slice(0, MAX_PHOTOS - photos.length)) {
        const key = await uploadReturnPhoto(asset);
        setPhotos((p) => [...p, { key, uri: asset.uri }].slice(0, MAX_PHOTOS));
      }
    } catch {
      haptic.warning();
      toast(s.trust.uploadFailed, 'alert-circle');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!order || !reason || !selected.length || needsPhoto || needsUnopened) return;
    setBusy(true);
    try {
      await requestReturn(order.id, {
        items: selected.map((r) => ({ orderItemId: r.itemId, quantity: Math.min(qtyOf(r.itemId), r.maxQty) })),
        reason,
        ...(note.trim() ? { note: note.trim() } : {}),
        ...(reason === 'damaged' ? { photoKeys: photos.map((p) => p.key) } : {}),
        ...(reason === 'changedMind' ? { unopened: true } : {}),
      });
      haptic.success();
      toast(reason === 'wrongPart' && allGuaranteed ? s.trust.autoApproved : s.orders.returnRequested, reason === 'wrongPart' && allGuaranteed ? 'shield' : 'rotate-ccw');
      router.back();
    } catch (e) {
      setBusy(false);
      haptic.warning();
      toast(s.trust.errors[String(toApiError(e).code)] ?? apiErrorMessage(s, e), 'alert-circle');
    }
  };

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.xxl, gap: space.md }} keyboardShouldPersistTaps="handled">
        <Text variant="title2">{s.orders.returnTitle}</Text>
        <Text variant="callout" color="textSecondary">
          {s.orders.returnBody(RETURN_WINDOW_DAYS)}
        </Text>
        {order && !eligible.length ? <Notice tone="info" text={s.remote.noReturnable} /> : null}
        {eligible.length ? (
          <Text variant="headline" style={{ marginTop: space.sm }}>
            {s.orders.selectItem}
          </Text>
        ) : null}
        {eligible.map((r) => {
          const item = order?.items.find((i) => i.id === r.itemId);
          if (!item) return null;
          const value = qtyOf(r.itemId);
          return (
            <View key={r.itemId} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, borderWidth: value > 0 ? 1.5 : 1, borderColor: value > 0 ? colors.primary : colors.line, backgroundColor: colors.surface }}>
              <PartArt kind={item.art} size={40} rounded={radius.xs} />
              <View style={{ flex: 1 }}>
                <Text variant="callout" weight="semibold" numberOfLines={2}>
                  {tx(item.name)}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {s.remote.returnQty}: {value} / {r.maxQty}
                </Text>
              </View>
              <Stepper value={value} min={0} max={r.maxQty} onChange={(v) => setQty((q) => ({ ...q, [r.itemId]: Math.max(0, Math.min(v, r.maxQty)) }))} />
            </View>
          );
        })}
        {eligible.length ? (
          <>
            <Text variant="headline" style={{ marginTop: space.sm }}>
              {s.orders.selectReason}
            </Text>
            {REASONS.map((r) => (
              <ChoiceRow key={r} title={s.orders.returnReasons[r]} selected={reason === r} onPress={() => setReason(r)} />
            ))}
            {hint ? <Notice tone={reason === 'wrongPart' && allGuaranteed ? 'success' : 'info'} icon={reason === 'wrongPart' && allGuaranteed ? 'shield' : 'info'} text={hint} /> : null}
            {reason === 'damaged' ? (
              <View style={{ gap: space.sm }}>
                <Text variant="headline">{s.trust.photosTitle}</Text>
                <Text variant="caption" color="textSecondary">
                  {s.trust.photosHint}
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                  {photos.map((p) => (
                    <View key={p.key} style={{ width: 76, height: 76, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surfaceSunken }}>
                      <Image source={{ uri: p.uri }} style={{ width: '100%', height: '100%' }} contentFit="cover" accessibilityIgnoresInvertColors />
                      <View style={{ position: 'absolute', top: 2, end: 2 }}>
                        <IconButton icon="x" label={s.trust.removePhoto} size={28} onPress={() => setPhotos((list) => list.filter((x) => x.key !== p.key))} />
                      </View>
                    </View>
                  ))}
                  {photos.length < MAX_PHOTOS ? (
                    <Pressable
                      onPress={addPhotos}
                      disabled={uploading}
                      accessibilityRole="button"
                      accessibilityLabel={s.trust.addPhoto}
                      style={{ width: 76, height: 76, borderRadius: radius.md, borderWidth: 1, borderStyle: 'dashed', borderColor: colors.lineStrong, alignItems: 'center', justifyContent: 'center', gap: 2 }}
                    >
                      <Icon name="camera" size={20} color="heading" />
                      <Text variant="micro" color="heading" align="center">
                        {uploading ? s.trust.uploading : s.trust.addPhoto}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
            {reason === 'changedMind' ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.md, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
                <Text variant="callout" style={{ flex: 1 }}>
                  {s.trust.unopenedLabel}
                </Text>
                <Toggle value={unopened} onChange={setUnopened} label={s.trust.unopenedLabel} />
              </View>
            ) : null}
            <Input label={`${s.remote.returnNote} (${s.common.optional})`} accessibilityLabel={s.remote.returnNote} value={note} onChangeText={setNote} maxLength={500} multiline />
            <Button label={s.orders.submitReturn} onPress={submit} disabled={!selected.length || !reason || needsPhoto || needsUnopened || uploading} loading={busy} style={{ marginTop: space.sm }} />
          </>
        ) : null}
        <Button label={s.common.close} variant="ghost" onPress={() => router.back()} />
      </ScrollView>
    </View>
  );
}
