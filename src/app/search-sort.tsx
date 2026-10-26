import { router } from 'expo-router';
import { View } from 'react-native';

import { isRemote } from '@/config/env';
import { useI18n } from '@/i18n';
import type { SortKey } from '@/services/catalog';
import { useSearchStore } from '@/store/search-store';
import { colors, gutter, space } from '@/theme/tokens';
import { ChoiceRow } from '@/ui/ChoiceRow';
import { Text } from '@/ui/Text';

// Remote mode has no verified ratings yet, so "top rated" would be an arbitrary order.
const keys: SortKey[] = isRemote ? ['relevance', 'priceAsc', 'priceDesc', 'fastest'] : ['relevance', 'priceAsc', 'priceDesc', 'rating', 'fastest'];

export default function SearchSortSheet() {
  const { s, isRTL } = useI18n();
  const sort = useSearchStore((st) => st.sort);
  const setSort = useSearchStore((st) => st.setSort);
  return (
    <View style={{ flex: 1, direction: isRTL ? 'rtl' : 'ltr', backgroundColor: colors.background, paddingHorizontal: gutter, paddingTop: space.xl, gap: space.sm }}>
      <Text variant="title2" style={{ marginBottom: space.sm }}>
        {s.search.sort}
      </Text>
      {keys.map((k) => (
        <ChoiceRow
          key={k}
          title={s.search.sortOptions[k]}
          selected={sort === k}
          onPress={() => {
            setSort(k);
            router.back();
          }}
        />
      ))}
    </View>
  );
}
