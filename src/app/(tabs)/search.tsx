import { router } from 'expo-router';
import { useEffect, useMemo, useRef } from 'react';
import { ActivityIndicator, FlatList, TextInput, View, type TextInputInstance } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PartArt } from '@/brand/PartArt';
import { allCategories, getCategory } from '@/data/catalog';
import type { CategoryId } from '@/domain/types';
import { PartRequestSearchCta } from '@/features/PartRequestEntry';
import { ProductRow } from '@/features/ProductCard';
import { useCatalogSearch, type CatalogSearchState } from '@/features/search/useCatalogSearch';
import { useI18n } from '@/i18n';
import { webNoOutline } from '@/lib/platform-styles';
import { vehicleLabel } from '@/lib/vehicle';
import { categorySuggestions, popularSearches, vehicleContextLabel, type ProductListing } from '@/services/catalog';
import { useAppStore, useSelectedVehicle } from '@/store/app-store';
import { activeFilterCount, useSearchStore } from '@/store/search-store';
import { enterUp } from '@/theme/motion';
import { colors, gutter, radius, space } from '@/theme/tokens';
import { Button } from '@/ui/Button';
import { Chip } from '@/ui/Chip';
import { EmptyState } from '@/ui/EmptyState';
import { HScroll } from '@/ui/HList';
import { Icon } from '@/ui/Icon';
import { ListGroup } from '@/ui/ListRow';
import { Notice } from '@/ui/Notice';
import { Pressable } from '@/ui/Pressable';
import { Screen } from '@/ui/Screen';
import { Skeleton } from '@/ui/Skeleton';
import { fontFamilyFor, Text } from '@/ui/Text';

type Row = { kind: 'item'; listing: ProductListing; index: number } | { kind: 'divider' } | { kind: 'hidden'; count: number };

function buildRows(search: CatalogSearchState): Row[] {
  const rows: Row[] = search.fits.map((listing, index) => ({ kind: 'item', listing, index }));
  if (search.others.length) {
    rows.push({ kind: 'divider' });
    search.others.forEach((listing, i) => rows.push({ kind: 'item', listing, index: search.fits.length + i }));
  }
  if (search.hiddenOthers > 0) rows.push({ kind: 'hidden', count: search.hiddenOthers });
  return rows;
}

export default function Search() {
  const { s, tx, lang, isRTL } = useI18n();
  const insets = useSafeAreaInsets();
  const vehicle = useSelectedVehicle();
  const { query, filters, sort, focusRequest, setQuery, patchFilters, resetFilters } = useSearchStore();
  const recentSearches = useAppStore((st) => st.recentSearches);
  const pushRecentSearch = useAppStore((st) => st.pushRecentSearch);
  const clearRecentSearches = useAppStore((st) => st.clearRecentSearches);
  const inputRef = useRef<TextInputInstance>(null);

  useEffect(() => {
    if (focusRequest > 0) {
      const t = setTimeout(() => inputRef.current?.focus(), 250);
      return () => clearTimeout(t);
    }
  }, [focusRequest]);

  const search = useCatalogSearch({ query, filters, sort, vehicle });
  const { interpretation } = search;
  const searchVehicle = interpretation.vehicle;
  const rows = buildRows(search);
  const visibleCount = search.fits.length + search.others.length;
  const categories = allCategories();
  const suggestedCategories = useMemo(() => (filters.categoryId ? [] : categorySuggestions(query)), [query, filters.categoryId]);
  const browsing = !query.trim() && !filters.categoryId;
  const filterCount = activeFilterCount(filters);
  const category = filters.categoryId ? getCategory(filters.categoryId) : undefined;
  const vehicleText = searchVehicle ? (searchVehicle.source === 'garage' && vehicle ? vehicleLabel(vehicle, lang) : tx(searchVehicle.label)) : '';
  const firstLoad = search.status === 'loading' && visibleCount === 0;

  const runSearch = (q: string) => {
    setQuery(q);
    pushRecentSearch(q);
  };

  const interpretationLabel = [
    ...interpretation.concepts.map((c) => tx(c.label)),
    ...(searchVehicle && searchVehicle.source === 'query' ? [tx(searchVehicle.label)] : []),
  ].join(' · ');

  const header = (
    <View style={{ paddingTop: insets.top + space.sm, paddingHorizontal: gutter, paddingBottom: space.sm, gap: space.md, backgroundColor: colors.background }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, height: 52, paddingHorizontal: space.lg, borderRadius: radius.lg, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line }}>
        <Icon name="search" size={20} color="textSecondary" />
        <TextInput
          ref={inputRef}
          value={query}
          onChangeText={setQuery}
          onSubmitEditing={() => pushRecentSearch(query)}
          placeholder={s.search.placeholder}
          placeholderTextColor={colors.textTertiary}
          selectionColor={colors.primary}
          returnKeyType="search"
          autoCorrect={false}
          autoCapitalize="none"
          accessibilityLabel={s.search.placeholder}
          style={{ flex: 1, minWidth: 0, outlineWidth: 0, ...webNoOutline, fontFamily: fontFamilyFor('regular', lang), fontSize: 16, color: colors.text, textAlign: isRTL ? 'right' : 'left', writingDirection: isRTL ? 'rtl' : 'ltr', paddingVertical: 0 }}
        />
        {search.status === 'loading' && !browsing ? <ActivityIndicator size="small" color={colors.textTertiary} accessibilityLabel={s.search2.loading} /> : null}
        {query ? (
          <Pressable onPress={() => setQuery('')} hitSlop={8} accessibilityLabel={s.search.clear}>
            <Icon name="x-circle" size={18} color="textTertiary" />
          </Pressable>
        ) : null}
      </View>
      <HScroll gap={space.sm} style={{ marginHorizontal: -gutter }} contentPadding={gutter}>
        <Chip label={s.search.filters} icon="sliders" count={filterCount} selected={filterCount > 0} onPress={() => router.push('/search-filters')} />
        <Chip label={s.search.sortOptions[sort]} icon="bar-chart-2" onPress={() => router.push('/search-sort')} />
        {vehicle || searchVehicle ? <Chip label={s.search.fitsOnly} icon="check-circle" selected={filters.fitsVehicleOnly} onPress={() => patchFilters({ fitsVehicleOnly: !filters.fitsVehicleOnly })} /> : null}
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
                <Text variant="callout" color="link" weight="semibold">
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

  const conceptCategories = [...new Set(interpretation.concepts.filter((c) => c.carried && c.categoryId).map((c) => c.categoryId as CategoryId))]
    .map((id) => getCategory(id))
    .filter((c): c is NonNullable<typeof c> => !!c && c.id !== filters.categoryId);

  const listHeader = (
    <View style={{ gap: 2, marginTop: space.xs }}>
      {interpretationLabel ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: space.sm, marginBottom: space.sm, paddingVertical: 6, paddingHorizontal: space.md, borderRadius: radius.pill, backgroundColor: colors.surfaceMuted }}>
          <Icon name="search" size={14} color="textSecondary" />
          <Text variant="caption" color="textSecondary" accessibilityLiveRegion="polite">
            {s.search2.searchingFor}:{' '}
            <Text variant="caption" weight="semibold">
              {interpretationLabel}
            </Text>
          </Text>
          {interpretation.withoutVehicle !== null ? (
            <Pressable onPress={() => setQuery(interpretation.withoutVehicle ?? '')} hitSlop={10} accessibilityLabel={s.search2.removeVehicle(searchVehicle ? tx(searchVehicle.label) : '')}>
              <Icon name="x" size={14} color="textSecondary" />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {searchVehicle?.yearOutOfRange ? (
        <View style={{ marginBottom: space.sm }}>
          <Notice tone="warning" icon="calendar" text={s.search2.yearOutOfRange(tx(vehicleContextLabel({ ...searchVehicle, year: undefined })))} />
        </View>
      ) : null}
      {searchVehicle && searchVehicle.scope !== 'vehicle' ? (
        <View style={{ marginBottom: space.sm }}>
          <Notice tone="info" icon="car" text={s.search2.modelOnlyHint(tx(searchVehicle.label))} />
        </View>
      ) : null}
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
      {search.partNumberQuery && visibleCount ? (
        <View style={{ marginBottom: space.sm }}>
          <Notice tone="info" icon="hash" text={s.search.partNumberMode} />
        </View>
      ) : null}
      {search.mode === 'similar' ? (
        <View style={{ marginBottom: space.sm }}>
          <Notice tone="warning" icon="search" text={s.search.similarResults(query.trim())} />
        </View>
      ) : search.mode === 'corrected' && search.correctedQuery ? (
        <View style={{ marginBottom: space.sm }}>
          <Notice tone="info" icon="search" text={s.search2.correctedResults(search.correctedQuery)} />
        </View>
      ) : search.mode === 'relaxed' ? (
        <View style={{ marginBottom: space.sm }}>
          <Notice tone="warning" icon="search" text={s.search2.relaxedResults} />
        </View>
      ) : null}
      {search.status === 'error' ? (
        <View style={{ marginBottom: space.sm, gap: space.sm }}>
          <Notice tone="danger" text={s.search2.error} />
          <Button label={s.common.retry} variant="secondary" size="sm" icon="refresh-ccw" onPress={search.retry} style={{ alignSelf: 'flex-start' }} />
        </View>
      ) : null}
      {search.fits.length === 0 && search.hiddenOthers > 0 && searchVehicle ? (
        <View style={{ marginBottom: space.sm }}>
          <Notice tone="warning" icon="car" text={s.search2.noFitting(vehicleText)} />
        </View>
      ) : null}
      {visibleCount > 0 ? (
        <Text variant="bodyStrong" accessibilityLiveRegion="polite">
          {s.search.results(search.total)}
        </Text>
      ) : null}
      {searchVehicle && searchVehicle.scope === 'vehicle' && visibleCount > 0 ? (
        <Text variant="caption" color="textSecondary">
          {searchVehicle.source === 'garage' ? s.search.filterFor(vehicleText) : s.search2.fitsFor(vehicleText)}
        </Text>
      ) : null}
    </View>
  );

  const empty = firstLoad ? (
    <View style={{ gap: space.md }} accessibilityLabel={s.search2.loading}>
      {[0, 1, 2].map((k) => (
        <Skeleton key={k} width="100%" height={122} rounded={radius.lg} />
      ))}
    </View>
  ) : search.status === 'error' ? null : (
    <View>
      {interpretation.unsupported.length ? (
        <EmptyState icon="package" title={s.search2.notCarried(tx(interpretation.unsupported[0].label))} body={s.search2.notCarriedHint} />
      ) : (
        <EmptyState
          icon="search"
          title={s.search.noResults}
          body={filters.fitsVehicleOnly && searchVehicle ? undefined : s.search.noResultsHint}
          action={
            filters.fitsVehicleOnly && searchVehicle
              ? { label: s.search.showAllParts, onPress: () => patchFilters({ fitsVehicleOnly: false }) }
              : filterCount > 0
                ? { label: s.search.clearFilters, onPress: resetFilters }
                : undefined
          }
        />
      )}
      {interpretationLabel ? (
        <View style={{ marginBottom: space.lg, gap: space.sm }}>
          <Text variant="headline">{s.search2.understood}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {interpretation.concepts.map((c) => (
              <Chip key={c.id} label={tx(c.label)} icon="tag" />
            ))}
            {searchVehicle && searchVehicle.source === 'query' ? <Chip label={tx(searchVehicle.label)} icon="car" /> : null}
          </View>
        </View>
      ) : null}
      <PartRequestSearchCta query={query} />
      {interpretation.didYouMean || conceptCategories.length ? (
        <View style={{ marginBottom: space.lg, gap: space.sm }}>
          <Text variant="headline">{s.search2.suggestions}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.sm }}>
            {interpretation.didYouMean && search.mode !== 'corrected' ? <Chip label={s.search2.didYouMean(interpretation.didYouMean)} icon="search" onPress={() => runSearch(interpretation.didYouMean ?? '')} /> : null}
            {conceptCategories.map((c) => (
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
        </View>
      ) : null}
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
  );

  return (
    <Screen header={header} scroll={false} padded={false}>
      <FlatList
        data={rows}
        keyExtractor={(row) => (row.kind === 'item' ? row.listing.product.id : row.kind)}
        keyboardDismissMode="on-drag"
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingHorizontal: gutter, paddingBottom: space.huge, gap: space.md }}
        onEndReachedThreshold={0.5}
        onEndReached={search.hasMore ? search.loadMore : undefined}
        ListHeaderComponent={listHeader}
        renderItem={({ item: row }) => {
          if (row.kind === 'divider') {
            return (
              <View style={{ marginTop: space.md, paddingTop: space.md, borderTopWidth: 1, borderTopColor: colors.line, gap: 2 }} accessibilityRole="header">
                <Text variant="headline">{s.search2.dividerTitle(vehicleText)}</Text>
                <Text variant="caption" color="textSecondary">
                  {s.search2.dividerHint}
                </Text>
              </View>
            );
          }
          if (row.kind === 'hidden') {
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md, marginTop: space.sm, padding: space.md, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed' }}>
                <Icon name="layers" size={18} color="textSecondary" />
                <Text variant="callout" color="textSecondary" style={{ flex: 1 }}>
                  {s.search2.hiddenOthers(row.count)}
                </Text>
                <Button label={s.search2.showAll} variant="secondary" size="sm" onPress={() => patchFilters({ fitsVehicleOnly: false })} />
              </View>
            );
          }
          return (
            <Animated.View entering={row.index < 8 ? enterUp(row.index) : undefined}>
              <ProductRow listing={row.listing} />
            </Animated.View>
          );
        }}
        ListFooterComponent={
          search.loadingMore ? (
            <View style={{ paddingVertical: space.lg, alignItems: 'center' }}>
              <ActivityIndicator color={colors.textTertiary} accessibilityLabel={s.search2.loadingMore} />
            </View>
          ) : undefined
        }
        ListEmptyComponent={empty ?? undefined}
      />
    </Screen>
  );
}
