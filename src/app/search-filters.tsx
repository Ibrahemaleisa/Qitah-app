import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, View } from 'react-native';

import { categories } from '@/data/catalog';
import type { Condition, PartOrigin } from '@/domain/types';
import { useI18n } from '@/i18n';
import { searchProducts, type SearchFilters } from '@/services/catalog';
import { useSelectedVehicle } from '@/store/app-store';
import { useSearchStore } from '@/store/search-store';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { Text } from '@/ui/Text';
import { Toggle } from '@/ui/Toggle';

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

export default function SearchFiltersSheet() {
  const { s, tx, isRTL } = useI18n();
  const vehicle = useSelectedVehicle();
  const store = useSearchStore();
  const [draft, setDraft] = useState<SearchFilters>(store.filters);
  const count = useMemo(() => searchProducts({ query: store.query, filters: draft, sort: store.sort, vehicle }).length, [draft, store.query, store.sort, vehicle]);

  const apply = () => {
    store.setFilters(draft);
    router.back();
  };

  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: gutter, paddingTop: space.xl, paddingBottom: space.md }}>
        <Text variant="title2">{s.search.filters}</Text>
        <Button label={s.common.reset} variant="ghost" size="sm" onPress={() => setDraft({ origins: [], conditions: [], inStockOnly: true, fitsVehicleOnly: draft.fitsVehicleOnly })} />
      </View>
      <ScrollView contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: space.xl, gap: space.xl }}>
        <FilterGroup title={s.search.filterSections.origin}>
          {(['oem', 'aftermarket'] as PartOrigin[]).map((o) => (
            <Chip key={o} label={s.origin[o]} selected={draft.origins.includes(o)} onPress={() => setDraft({ ...draft, origins: toggle(draft.origins, o) })} />
          ))}
        </FilterGroup>
        <FilterGroup title={s.search.filterSections.condition}>
          {(['new', 'used', 'refurbished'] as Condition[]).map((c) => (
            <Chip key={c} label={s.condition[c]} selected={draft.conditions.includes(c)} onPress={() => setDraft({ ...draft, conditions: toggle(draft.conditions, c) })} />
          ))}
        </FilterGroup>
        <FilterGroup title={s.search.filterSections.category}>
          <Chip label={s.search.allCategories} selected={!draft.categoryId} onPress={() => setDraft({ ...draft, categoryId: undefined })} />
          {categories.map((c) => (
            <Chip key={c.id} label={tx(c.name)} selected={draft.categoryId === c.id} onPress={() => setDraft({ ...draft, categoryId: c.id })} />
          ))}
        </FilterGroup>
        <View style={{ backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line }}>
          <SwitchRow label={s.search.inStockOnly} value={draft.inStockOnly} onChange={(v) => setDraft({ ...draft, inStockOnly: v })} />
          {vehicle ? <SwitchRow label={s.search.fitsOnly} value={draft.fitsVehicleOnly} onChange={(v) => setDraft({ ...draft, fitsVehicleOnly: v })} last /> : null}
        </View>
      </ScrollView>
      <View style={{ paddingHorizontal: gutter, paddingTop: space.md, paddingBottom: space.xxl, borderTopWidth: 1, borderTopColor: colors.line, backgroundColor: colors.surface }}>
        <Button label={s.search.showResults(count)} onPress={apply} disabled={count === 0} />
      </View>
    </View>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: space.sm }}>
      <Text variant="headline">{title}</Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>{children}</View>
    </View>
  );
}

function SwitchRow({ label, value, onChange, last }: { label: string; value: boolean; onChange: (v: boolean) => void; last?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.lg, paddingVertical: space.md, borderBottomWidth: last ? 0 : 1, borderBottomColor: colors.line }}>
      <Text variant="bodyStrong" weight="medium">
        {label}
      </Text>
      <Toggle value={value} onChange={onChange} label={label} />
    </View>
  );
}
