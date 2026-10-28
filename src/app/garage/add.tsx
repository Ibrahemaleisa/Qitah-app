import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import Animated, { useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { garageApi } from '@/api/endpoints';
import { toApiError } from '@/api/client';
import { isRemote } from '@/config/env';
import { allMakes, getMake, getModel } from '@/data/vehicles';
import { useI18n } from '@/i18n';
import { apiErrorMessage } from '@/lib/api-errors';
import { haptic } from '@/lib/haptics';
import { formatKm, parseKm } from '@/lib/odometer';
import { formatVin, isValidVin } from '@/lib/vehicle';
import { decodeVin } from '@/lib/vin';
import { addVehicle } from '@/services/remote/account';
import { useAppStore } from '@/store/app-store';
import { enterUp } from '@/theme/motion';
import { colors, radius, space } from '@/theme/tokens';
import { Badge } from '@/ui/Badge';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Icon, type IconName } from '@/ui/Icon';
import { Input } from '@/ui/Input';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

/**
 * Faster garage: step 1 offers "enter the VIN" (offline partial decode → make + year pre-filled, so only
 * model and engine are asked) or "choose manually". Trim is never asked (fitment does not use it), and the
 * engine is asked only when the model has more than one.
 */

type Step = 'method' | 'vin' | 'make' | 'model' | 'year' | 'engine' | 'details';
type Draft = { makeId?: string; modelId?: string; year?: number; engine?: string };
type Decoded = { valid: boolean; makeId?: string; modelYear?: number; confidence: string; reasons: string[] };

async function decode(vin: string): Promise<Decoded> {
  const local = () => {
    const d = decodeVin(vin);
    const make = d.make && getMake(d.make) ? d.make : undefined;
    return { valid: d.valid, makeId: make, modelYear: d.modelYear, confidence: d.make && !make ? 'low' : d.confidence, reasons: d.reasons };
  };
  if (!isRemote) return local();
  try {
    const r = await garageApi.decodeVin(vin);
    return { valid: r.valid, makeId: r.make?.id && getMake(r.make.id) ? r.make.id : undefined, modelYear: r.modelYear, confidence: r.confidence, reasons: r.reasons };
  } catch (e) {
    // Offline: the same decoder runs on the device.
    if (toApiError(e).isNetwork) return local();
    throw e;
  }
}

export default function AddVehicle() {
  const { s, tx } = useI18n();
  const signedIn = useAppStore((st) => !!st.user);
  const makes = allMakes();
  const [mode, setMode] = useState<'vin' | 'manual'>('manual');
  const [step, setStep] = useState<Step>('method');
  const [history, setHistory] = useState<Step[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [vin, setVin] = useState('');
  const [vinError, setVinError] = useState<string>();
  const [decoded, setDecoded] = useState<Decoded>();
  const [decoding, setDecoding] = useState(false);
  const [odometer, setOdometer] = useState('');
  const [odoError, setOdoError] = useState<string>();
  const [saving, setSaving] = useState(false);

  const model = draft.modelId ? getModel(draft.modelId) : undefined;
  const make = draft.makeId ? getMake(draft.makeId) : undefined;
  const years = useMemo(() => {
    if (!model) return [];
    const list: number[] = [];
    for (let y = model.yearTo; y >= model.yearFrom; y--) list.push(y);
    return list;
  }, [model]);

  // The path this vehicle will take (for the progress bar): VIN skips make (and year when it fits the model).
  const path: Step[] = useMemo(() => {
    const p: Step[] = ['method'];
    if (mode === 'vin') {
      p.push('vin');
      if (!decoded?.makeId) p.push('make');
    } else p.push('make');
    p.push('model');
    const yearKnown = mode === 'vin' && !!decoded?.modelYear && !!model && decoded.modelYear >= model.yearFrom && decoded.modelYear <= model.yearTo;
    if (!yearKnown) p.push('year');
    if (!model || model.engines.length > 1) p.push('engine');
    p.push('details');
    return p;
  }, [mode, decoded, model]);
  const index = Math.max(0, path.indexOf(step));
  const progress = useAnimatedStyle(() => ({ width: withTiming(`${((index + 1) / path.length) * 100}%`, { duration: 260 }) }));

  const go = (next: Step) => {
    setHistory((h) => [...h, step]);
    setStep(next);
  };
  const goBack = () => {
    const prev = history[history.length - 1];
    if (!prev) return router.back();
    setHistory((h) => h.slice(0, -1));
    setStep(prev);
  };

  /** After the model: year (unless the VIN gave one that fits), then engine (only if several). */
  const afterModel = (modelId: string) => {
    const m = getModel(modelId);
    if (!m) return;
    const fits = mode === 'vin' && decoded?.modelYear && decoded.modelYear >= m.yearFrom && decoded.modelYear <= m.yearTo;
    const engine = m.engines.length === 1 ? m.engines[0] : undefined;
    setDraft((d) => ({ ...d, modelId, year: fits ? decoded!.modelYear : undefined, engine }));
    haptic.tap();
    if (!fits) go('year');
    else go(m.engines.length > 1 ? 'engine' : 'details');
  };
  const afterYear = (year: number) => {
    haptic.tap();
    setDraft((d) => ({ ...d, year }));
    go(model && model.engines.length > 1 ? 'engine' : 'details');
  };

  const runDecode = async () => {
    const clean = vin.trim().toUpperCase();
    if (!isValidVin(clean)) {
      setVinError(s.garage.vinInvalid);
      haptic.warning();
      return;
    }
    setDecoding(true);
    try {
      const d = await decode(clean);
      setDecoded(d);
      if (!d.valid) {
        setVinError(s.garage2.reasons[d.reasons[0]] ?? s.garage.vinInvalid);
        haptic.warning();
        return;
      }
      haptic.success();
      if (d.makeId) {
        setDraft({ makeId: d.makeId });
        go('model');
      }
    } catch (e) {
      toast(apiErrorMessage(s, e), 'alert-circle');
    } finally {
      setDecoding(false);
    }
  };

  const save = async () => {
    if (!draft.makeId || !draft.modelId || !draft.year || !draft.engine) return;
    const cleanVin = vin.trim().toUpperCase();
    if (cleanVin && !isValidVin(cleanVin)) {
      setVinError(s.garage.vinInvalid);
      haptic.warning();
      return;
    }
    const odo = odometer.trim() ? parseKm(odometer) : undefined;
    if (odometer.trim() && odo === undefined) {
      setOdoError(s.garage2.odometerInvalid);
      haptic.warning();
      return;
    }
    setSaving(true);
    try {
      // Remote + signed in: saved to the account (POST /v1/me/vehicles). Otherwise kept on device.
      await addVehicle({
        makeId: draft.makeId,
        modelId: draft.modelId,
        year: draft.year,
        trim: '',
        engine: draft.engine,
        vin: cleanVin || undefined,
        odometerKm: odo,
      });
    } catch (e) {
      setSaving(false);
      haptic.warning();
      toast(apiErrorMessage(s, e), 'alert-circle');
      return;
    }
    setSaving(false);
    haptic.success();
    toast(`${make ? tx(make.name) : ''} ${model ? tx(model.name) : ''} ${draft.year}${signedIn && isRemote ? ` · ${s.remote.syncedToAccount}` : ''}`);
    router.back();
  };

  const chips: { label: string; step: Step }[] = [
    make ? { label: tx(make.name), step: mode === 'vin' ? 'vin' : 'make' } : null,
    model ? { label: tx(model.name), step: 'model' } : null,
    draft.year ? { label: String(draft.year), step: 'year' } : null,
    draft.engine && model && model.engines.length > 1 ? { label: draft.engine, step: 'engine' } : null,
  ].filter((x): x is { label: string; step: Step } => !!x);

  const footer =
    step === 'vin' ? (
      <StickyFooter>
        <Button label={s.garage2.decode} icon="search" onPress={runDecode} disabled={!vin.trim() || decoding} loading={decoding} />
      </StickyFooter>
    ) : step === 'details' ? (
      <StickyFooter>
        <Button label={s.garage.saveVehicle} onPress={save} disabled={saving} loading={saving} />
      </StickyFooter>
    ) : undefined;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        header={
          <View>
            <ScreenHeader back dismiss={step === 'method' ? 'close' : 'back'} inSheet title={s.garage.add} subtitle={s.garage.stepOf(index + 1, path.length)} />
            <View style={{ height: 3, backgroundColor: colors.line }}>
              <Animated.View style={[{ height: 3, backgroundColor: colors.primary }, progress]} />
            </View>
          </View>
        }
        footer={footer}
      >
        {chips.length && step !== 'method' ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.lg }}>
            {chips.map((c) => (
              <Pressable
                key={c.step + c.label}
                onPress={() => go(c.step)}
                haptics="tap"
                accessibilityLabel={c.label}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm + 2, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }}
              >
                <Text variant="caption" weight="semibold">
                  {c.label}
                </Text>
                <Icon name="edit-2" size={11} color="textTertiary" />
              </Pressable>
            ))}
          </View>
        ) : null}

        <Animated.View key={step} entering={enterUp()} style={{ marginTop: space.xl, gap: space.md }}>
          <Text variant="title1">{step === 'method' ? s.garage2.howTitle : s.garage2.steps[step]}</Text>

          {step === 'method' ? (
            <View style={{ gap: space.md }}>
              <MethodCard
                icon="hash"
                title={s.garage2.byVin}
                hint={s.garage2.byVinHint}
                onPress={() => {
                  haptic.tap();
                  setMode('vin');
                  go('vin');
                }}
              />
              <MethodCard
                icon="car"
                title={s.garage2.manual}
                hint={s.garage2.manualHint}
                onPress={() => {
                  haptic.tap();
                  setMode('manual');
                  setDecoded(undefined);
                  go('make');
                }}
              />
            </View>
          ) : null}

          {step === 'vin' ? (
            <View style={{ gap: space.md }}>
              <Text variant="callout" color="textSecondary">
                {s.garage2.vinPrompt}
              </Text>
              <Input
                value={vin}
                onChangeText={(v) => {
                  setVin(v.toUpperCase());
                  setVinError(undefined);
                  setDecoded(undefined);
                }}
                placeholder={s.garage.vinPlaceholder}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={17}
                ltr
                error={vinError}
                icon="hash"
                style={{ letterSpacing: 1.5 }}
                onSubmitEditing={runDecode}
              />
              {decoded?.valid ? <DecodeResult decoded={decoded} onManual={() => go('make')} /> : null}
            </View>
          ) : null}

          {step === 'make' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {makes.map((m) => (
                <Tile
                  key={m.id}
                  label={tx(m.name)}
                  selected={draft.makeId === m.id}
                  onPress={() => {
                    haptic.tap();
                    setDraft({ makeId: m.id });
                    go('model');
                  }}
                />
              ))}
            </View>
          ) : null}

          {step === 'model' && make ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {make.models.map((m) => (
                <Tile key={m.id} label={tx(m.name)} hint={`${m.yearFrom}–${m.yearTo}`} selected={draft.modelId === m.id} onPress={() => afterModel(m.id)} />
              ))}
            </View>
          ) : null}

          {step === 'year' ? (
            <View style={{ gap: space.md }}>
              {mode === 'vin' && decoded?.modelYear && model && !years.includes(decoded.modelYear) ? <Notice tone="warning" text={s.garage2.yearOutOfRange(decoded.modelYear)} /> : null}
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
                {years.map((y) => (
                  <Chip key={y} label={String(y)} selected={draft.year === y} onPress={() => afterYear(y)} />
                ))}
              </View>
            </View>
          ) : null}

          {step === 'engine' && model ? (
            <View style={{ gap: space.sm }}>
              {model.engines.map((e) => (
                <Pressable
                  key={e}
                  onPress={() => {
                    haptic.tap();
                    setDraft((d) => ({ ...d, engine: e }));
                    go('details');
                  }}
                  haptics="tap"
                  accessibilityLabel={e}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: draft.engine === e ? 1.5 : 1, borderColor: draft.engine === e ? colors.text : colors.line }}
                >
                  <Icon name="settings" size={18} color="heading" />
                  <Text variant="bodyStrong" style={{ flex: 1 }} ltr>
                    {e}
                  </Text>
                  <Icon name="chevron-right" size={18} color="textTertiary" />
                </Pressable>
              ))}
            </View>
          ) : null}

          {step === 'details' ? (
            <View style={{ gap: space.lg }}>
              {mode === 'vin' && vin ? (
                <View style={{ gap: 4 }}>
                  <Text variant="captionStrong" color="textSecondary">
                    {s.garage.vinLabel}
                  </Text>
                  <Text variant="bodyStrong" mono ltr>
                    {formatVin(vin)}
                  </Text>
                  <Text variant="caption" color="textTertiary">
                    {s.garage2.vinLocked}
                  </Text>
                </View>
              ) : (
                <Input
                  label={`${s.garage.steps.vin} · ${s.common.optional}`}
                  value={vin}
                  onChangeText={(v) => {
                    setVin(v.toUpperCase());
                    setVinError(undefined);
                  }}
                  placeholder={s.garage.vinPlaceholder}
                  autoCapitalize="characters"
                  autoCorrect={false}
                  maxLength={17}
                  ltr
                  error={vinError}
                  hint={s.garage.vinHint}
                  icon="hash"
                  style={{ letterSpacing: 1.5 }}
                />
              )}
              <Input
                label={s.garage2.odometerOptional}
                value={odometer}
                onChangeText={(v) => {
                  setOdometer(v);
                  setOdoError(undefined);
                }}
                placeholder={s.garage2.odometerPlaceholder}
                keyboardType="number-pad"
                maxLength={9}
                ltr
                error={odoError}
                hint={!odoError && parseKm(odometer) ? s.garage2.km(formatKm(parseKm(odometer)!)) : s.garage2.odometerHint}
                icon="trending-up"
              />
            </View>
          ) : null}
        </Animated.View>
        {step !== 'method' ? <Button label={s.common.back} variant="ghost" size="sm" icon="chevron-left" onPress={goBack} style={{ alignSelf: 'flex-start', marginTop: space.lg }} /> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

function DecodeResult({ decoded, onManual }: { decoded: Decoded; onManual: () => void }) {
  const { s, tx } = useI18n();
  const make = decoded.makeId ? getMake(decoded.makeId) : undefined;
  const tone = decoded.confidence === 'high' ? 'success' : decoded.confidence === 'medium' ? 'info' : 'warning';
  return (
    <View style={{ gap: space.sm, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
      {make ? (
        <Text variant="bodyStrong">{s.garage2.decodedMakeYear(tx(make.name), decoded.modelYear)}</Text>
      ) : null}
      <View style={{ flexDirection: 'row' }}>
        <Badge label={s.garage2.confidence[decoded.confidence] ?? decoded.confidence} tone={tone} />
      </View>
      {decoded.reasons.map((r) =>
        s.garage2.reasons[r] ? (
          <Text key={r} variant="caption" color="textSecondary">
            {s.garage2.reasons[r]}
          </Text>
        ) : null,
      )}
      {!make ? <Button label={s.garage2.continueManual} variant="secondary" size="md" icon="chevron-right" onPress={onManual} /> : null}
    </View>
  );
}

function MethodCard({ icon, title, hint, onPress }: { icon: IconName; title: string; hint: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      haptics="tap"
      accessibilityLabel={title}
      accessibilityHint={hint}
      style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}
    >
      <View style={{ width: 44, height: 44, borderRadius: radius.md, backgroundColor: colors.surfaceSunken, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={20} color="heading" />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        <Text variant="caption" color="textSecondary">
          {hint}
        </Text>
      </View>
      <Icon name="chevron-right" size={18} color="textTertiary" />
    </Pressable>
  );
}

function Tile({ label, hint, selected, onPress }: { label: string; hint?: string; selected?: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      haptics="tap"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      style={{ width: '48.5%', paddingVertical: space.lg, paddingHorizontal: space.md, borderRadius: radius.md, backgroundColor: selected ? colors.inverse : colors.surface, borderWidth: 1, borderColor: selected ? colors.inverse : colors.line, gap: 2 }}
    >
      <Text variant="bodyStrong" color={selected ? 'textInverse' : 'text'}>
        {label}
      </Text>
      {hint ? (
        <Text variant="caption" color={selected ? 'textInverse' : 'textTertiary'} ltr>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  );
}
