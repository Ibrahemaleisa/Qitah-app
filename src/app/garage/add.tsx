import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import Animated, { FadeInDown, useAnimatedStyle, withTiming } from 'react-native-reanimated';

import { getMake, getModel, makes } from '@/data/vehicles';
import { useI18n } from '@/i18n';
import { haptic } from '@/lib/haptics';
import { isValidVin } from '@/lib/vehicle';
import { useAppStore } from '@/store/app-store';
import { colors, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Icon } from '@/ui/Icon';
import { Input } from '@/ui/Input';
import { Pressable } from '@/ui/Pressable';
import { Screen, ScreenHeader, StickyFooter } from '@/ui/Screen';
import { Text } from '@/ui/Text';
import { toast } from '@/ui/Toast';

const STEPS = ['make', 'model', 'year', 'trim', 'engine', 'vin'] as const;
type Step = (typeof STEPS)[number];

type Draft = { makeId?: string; modelId?: string; year?: number; trim?: string; engine?: string };

export default function AddVehicle() {
  const { s, tx } = useI18n();
  const addVehicle = useAppStore((st) => st.addVehicle);
  const [step, setStep] = useState<Step>('make');
  const [draft, setDraft] = useState<Draft>({});
  const [vin, setVin] = useState('');
  const [vinError, setVinError] = useState<string>();
  const index = STEPS.indexOf(step);
  const model = draft.modelId ? getModel(draft.modelId) : undefined;
  const make = draft.makeId ? getMake(draft.makeId) : undefined;

  const years = useMemo(() => {
    if (!model) return [];
    const list: number[] = [];
    for (let y = model.yearTo; y >= model.yearFrom; y--) list.push(y);
    return list;
  }, [model]);

  const progress = useAnimatedStyle(() => ({ width: withTiming(`${((index + 1) / STEPS.length) * 100}%`, { duration: 260 }) }));

  const choose = (patch: Draft, next: Step) => {
    haptic.tap();
    setDraft((d) => ({ ...d, ...patch }));
    setStep(next);
  };

  const goBack = () => {
    if (index === 0) router.back();
    else setStep(STEPS[index - 1]);
  };

  const save = (withVin: boolean) => {
    if (!draft.makeId || !draft.modelId || !draft.year || !draft.trim || !draft.engine) return;
    const cleanVin = vin.trim().toUpperCase();
    if (withVin && cleanVin && !isValidVin(cleanVin)) {
      setVinError(s.garage.vinInvalid);
      haptic.warning();
      return;
    }
    addVehicle({ makeId: draft.makeId, modelId: draft.modelId, year: draft.year, trim: draft.trim, engine: draft.engine, vin: withVin && cleanVin ? cleanVin : undefined });
    haptic.success();
    toast(`${make ? tx(make.name) : ''} ${model ? tx(model.name) : ''} ${draft.year}`);
    router.back();
  };

  const summary = [make ? tx(make.name) : null, model ? tx(model.name) : null, draft.year ? String(draft.year) : null, draft.trim, draft.engine].filter(Boolean) as string[];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Screen
        header={
          <View>
            <ScreenHeader back dismiss={index === 0 ? 'close' : 'back'} inSheet title={s.garage.add} subtitle={s.garage.stepOf(index + 1, STEPS.length)} />
            <View style={{ height: 3, backgroundColor: colors.line }}>
              <Animated.View style={[{ height: 3, backgroundColor: colors.accent }, progress]} />
            </View>
          </View>
        }
        footer={
          step === 'vin' ? (
            <StickyFooter>
              <Button label={s.garage.saveVehicle} onPress={() => save(true)} disabled={!vin.trim()} />
              <Button label={s.garage.skipVin} variant="ghost" size="md" onPress={() => save(false)} />
            </StickyFooter>
          ) : undefined
        }
      >
        {index > 0 ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.lg }}>
            {summary.map((label, i) => (
              <Pressable key={i} onPress={() => setStep(STEPS[i])} haptics="tap" accessibilityLabel={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: space.sm + 2, paddingVertical: 4, borderRadius: radius.pill, backgroundColor: colors.surfaceSunken }}>
                <Text variant="caption" weight="semibold">
                  {label}
                </Text>
                <Icon name="edit-2" size={11} color="textTertiary" />
              </Pressable>
            ))}
          </View>
        ) : null}

        <Animated.View key={step} entering={FadeInDown.duration(240)} style={{ marginTop: space.xl, gap: space.md }}>
          <Text variant="title1">{s.garage.steps[step]}</Text>

          {step === 'make' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {makes.map((m) => (
                <Tile key={m.id} label={tx(m.name)} selected={draft.makeId === m.id} onPress={() => choose({ makeId: m.id, modelId: undefined, year: undefined, trim: undefined, engine: undefined }, 'model')} />
              ))}
            </View>
          ) : null}

          {step === 'model' && make ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {make.models.map((m) => (
                <Tile key={m.id} label={tx(m.name)} hint={`${m.yearFrom}–${m.yearTo}`} selected={draft.modelId === m.id} onPress={() => choose({ modelId: m.id, year: undefined, trim: undefined, engine: undefined }, 'year')} />
              ))}
            </View>
          ) : null}

          {step === 'year' ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {years.map((y) => (
                <Chip key={y} label={String(y)} selected={draft.year === y} onPress={() => choose({ year: y }, 'trim')} />
              ))}
            </View>
          ) : null}

          {step === 'trim' && model ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {model.trims.map((t) => (
                <Chip key={t} label={t} selected={draft.trim === t} onPress={() => choose({ trim: t }, 'engine')} />
              ))}
            </View>
          ) : null}

          {step === 'engine' && model ? (
            <View style={{ gap: space.sm }}>
              {model.engines.map((e) => (
                <Pressable key={e} onPress={() => choose({ engine: e }, 'vin')} haptics="tap" accessibilityLabel={e} style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, padding: space.lg, borderRadius: radius.md, backgroundColor: colors.surface, borderWidth: draft.engine === e ? 1.5 : 1, borderColor: draft.engine === e ? colors.text : colors.line }}>
                  <Icon name="settings" size={18} color="accent" />
                  <Text variant="bodyStrong" style={{ flex: 1 }} ltr>
                    {e}
                  </Text>
                  <Icon name="chevron-right" size={18} color="textTertiary" />
                </Pressable>
              ))}
            </View>
          ) : null}

          {step === 'vin' ? (
            <View style={{ gap: space.md }}>
              <Text variant="callout" color="textSecondary">
                {s.common.optional}
              </Text>
              <Input
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
            </View>
          ) : null}
        </Animated.View>
        {step !== 'make' ? <Button label={s.common.back} variant="ghost" size="sm" icon="chevron-left" onPress={goBack} style={{ alignSelf: 'flex-start', marginTop: space.lg }} /> : null}
      </Screen>
    </KeyboardAvoidingView>
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
