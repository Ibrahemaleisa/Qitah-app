import { router } from 'expo-router';
import { useDeferredValue, useEffect, useMemo, useRef } from 'react';
import { FlatList, TextInput, View, type TextInputInstance } from 'react-native';
import Animated, { FadeIn } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PartArt } from '@/brand/PartArt';
import { categories, getCategory } from '@/data/catalog';
import { ProductRow } from '@/features/ProductCard';
import { useI18n } from '@/i18n';
import { webNoOutline } from '@/lib/platform-styles';
import { vehicleLabel } from '@/lib/vehicle';
import { categorySuggestions, popularSearches, searchWithFallback } from '@/services/catalog';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { activeFilterCount, useSearchStore } from '@/store/search-store';
import { colors, fonts, gutter, radius, space } from '@/theme/tokens';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { HScroll } from '@/ui/HList';
import { Icon } from '@/ui/Icon';
import { ListGroup } from '@/ui/ListRow';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen } from '@/ui/Screen';
import { Text } from '@/ui/Text';

export default function Search() {
  const { s, tx, lang, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const vehicle = useSelectedVehicle();
  const { query, filters, sort, focusRequest, setQuery, patchFilters, resetFilters } = useSearchStore();
  const recentSearches = useAppStore((st) => st.recentSearches);
  const pushRecentSearch = useAppStore((st) => st.pushRecentSearch);
  const clearRecentSearches = useAppStore((st) => st.clearRecentSearches);
  const inputRef = useRef<TextInputInstance>(null);
  const deferredQuery = useDeferredValue(query);

  useEffect(() => {
    if (focusRequest > 0) {
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [focusRequest]);

  const outcome = useMemo(() => searchWithFallback({ query: deferredQuery, filters, sort, vehicle }), [deferredQuery, filters, sort, vehicle]);
  const results = outcome.results;
  const suggestedCategories = useMemo(() => (filters.categoryId ? [] : categorySuggestions(deferredQuery)), [deferredQuery, filters.categoryId]);
  const browsing = !query.trim() && !filters.categoryId;
  const filterCount = activeFilterCount(filters);
  const category = filters.categoryId ? getCategory(filters.categoryId) : undefined;

  const runSearch = (q: string) => {
    setQuery(q);
    pushRecentSearch(q);
  };

  const header = (
    <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: space.sm, gap: space.md, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 52, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
        <Icon name="search" size={20} color="accent" />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => pushRecentSearch(query)}
          placeholder={s.search.placeholder}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.accent}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={s.search.placeholder}
          style={{ flex: 1, minWidth: 0, outlineWidth: 0, ...webNoOutline, fontFamily: fonts.regular, fontSize: 16, color: colors.text, textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr', paddingVertical: 0 }}
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel={s.search.clear}>
            <Icon name="x-circle" size={18} color="textTertiary" />
          </Pressable>
        ) : null}
      </View>
      <HScroll gap={space.sm} style={{ marginHorizontal: -gutter }} contentPadding={gutter}>
        <Chip label={s.search.filters} icon="sliders" count={filterCount} selected={filterCount > 0} onPress={() => router.push('/search-filters')} />
        <Chip label={s.search.sortOptions[sort]} icon="bar-chart-2" onPress={() => router.push('/search-sort')} />
        {vehicle ? <Chip label={s.search.fitsOnly} icon="check-circle" selected={filters.fitsVehicleOnly} onPress={() => patchFilters({ fitsVehicleOnly: !filters.fitsVehicleOnly })} /> : null}
        {category ? <Chip label={tx(category.name)} icon="x" selected onPress={() => patchFilters({ categoryId: undefined })} /> : null}
      </HScroll>
    </View>
  );

  if (browsing) {
    return (
      <Screen header={header}>
        <Text variant="caption" color="textTertiary" style={{ marginTop: space.xs }}>
          {s.search.modeHint}
        </Text>
        {recentSearches.length ? (
          <View style={{ marginTop: space.xl }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.sm }}>
              <Text variant="headline">{s.search.recentSearches}</Text>
              <Pressable onPress={clearRecentSearches} hitSlop={8} accessibilityLabel={s.search.clear}>
                <Text variant="callout" color="accentPressed" weight="semibold">
                  {s.search.clear}
                </Text>
              </Pressable>
            </View>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {recentSearches.map((q) => (
                <Chip key={q} label={q} icon="clock" onPress={() => runSearch(q)} />
              ))}
            </View>
          </View>
        ) : null}
        <View style={{ marginTop: space.xl }}>
          <Text variant="headline" style={{ marginBottom: space.sm }}>
            {s.search.popular}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {popularSearches.map((p) => (
              <Chip key={p.en} label={p[lang]} icon="trending-up" onPress={() => runSearch(p[lang])} />
            ))}
          </View>
        </View>
        <View style={{ marginTop: space.xl }}>
          <Text variant="headline" style={{ marginBottom: space.sm }}>
            {s.search.browseCategories}
          </Text>
          <ListGroup>
            {categories.map((c, i) => (
              <Pressable key={c.id} onPress={() => patchFilters({ categoryId: c.id })} pressScale={0.99} haptics="tap" accessibilityLabel={tx(c.name)}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, paddingVertical: space.sm, paddingHorizontal: space.md, borderBottomWidth: i === categories.length - 1 ? 0 : 1, borderBottomColor: colors.line }}>
                  <PartArt kind={c.art} size={44} rounded={radius.sm} background={colors.surfaceMuted} />
                  <Text variant="bodyStrong" weight="medium" style={{ flex: 1 }}>
                    {tx(c.name)}
                  </Text>
                  <Icon name="chevron-right" size={18} color="textTertiary" />
                </View>
              </Pressable>
            ))}
          </ListGroup>
        </View>
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll={false} padded={false}>
      <FlatList
        data={results}
        keyExtractor={(l) => l.product.id}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: space.huge, gap: space.md }}
        ListHeaderComponent={
          <View style={{ gap: 2, marginTop: space.xs }}>
            {suggestedCategories.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm, marginBottom: space.sm }}>
                {suggestedCategories.map((c) => (
                  <Chip
                    key={c.id}
                    label={s.search.inCategory(tx(c.name))}
                    icon="grid"
                    onPress={() => {
                      setQuery('');
                      patchFilters({ categoryId: c.id });
                    }}
                  />
                ))}
              </View>
            ) : null}
            {outcome.partNumberQuery && results.length ? (
              <View style={{ marginBottom: space.sm }}>
                <Notice tone="info" icon="hash" text={s.search.partNumberMode} />
              </View>
            ) : null}
            {outcome.mode === 'similar' ? (
              <View style={{ marginBottom: space.sm }}>
                <Notice tone="warning" icon="search" text={s.search.similarResults(deferredQuery.trim())} />
              </View>
            ) : null}
            <Text variant="bodyStrong" accessibilityLiveRegion="polite">
              {s.search.results(results.length)}
            </Text>
            {vehicle ? (
              <Text variant="caption" color="textSecondary">
                {s.search.filterFor(vehicleLabel(vehicle, lang))}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item, index }) => (
          <Animated.View entering={index < 8 ? FadeIn.delay(index * 25).duration(220) : undefined}>
            <ProductRow listing={item} />
          </Animated.View>
        )}
        ListEmptyComponent={
          <View>
            <EmptyState
              icon="search"
              title={s.search.noResults}
              body={filters.fitsVehicleOnly ? undefined : s.search.noResultsHint}
              action={
                filters.fitsVehicleOnly
                  ? { label: s.search.showAllParts, onPress: () => patchFilters({ fitsVehicleOnly: false }) }
                  : filterCount > 0
                    ? { label: s.search.clearFilters, onPress: resetFilters }
                    : undefined
              }
            />
            <Text variant="caption" color="textSecondary" align="center" style={{ marginBottom: space.lg }}>
              {s.search.partNumberTip}
            </Text>
            <Text variant="headline" style={{ marginBottom: space.sm }}>
              {s.search.tryPopular}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
              {popularSearches.map((p) => (
                <Chip key={p.en} label={p[lang]} icon="trending-up" onPress={() => runSearch(p[lang])} />
              ))}
            </View>
          </View>
        }
      />
    </Screen>
  );
}

