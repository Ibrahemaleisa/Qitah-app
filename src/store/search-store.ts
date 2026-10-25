import { create } from 'zustand';

import { defaultFilters, type SearchFilters, type SortKey } from '@/services/catalog';

/** Ephemeral search UI state shared between the search screen and its filter/sort sheets. */
type SearchState = {
  query: string;
  filters: SearchFilters;
  sort: SortKey;
  /** Incremented to ask the search screen to focus its input. */
  focusRequest: number;
  requestFocus: () => void;
  setQuery: (q: string) => void;
  setFilters: (f: SearchFilters) => void;
  patchFilters: (f: Partial<SearchFilters>) => void;
  setSort: (s: SortKey) => void;
  resetFilters: () => void;
};

export const useSearchStore = create<SearchState>()((set) => ({
  query: '',
  filters: { ...defaultFilters },
  sort: 'relevance',
  focusRequest: 0,
  requestFocus: () => set((s) => ({ focusRequest: s.focusRequest + 1 })),
  setQuery: (query) => set({ query }),
  setFilters: (filters) => set({ filters }),
  patchFilters: (patch) => set((s) => ({ filters: { ...s.filters, ...patch } })),
  setSort: (sort) => set({ sort }),
  resetFilters: () => set((s) => ({ filters: { ...defaultFilters, fitsVehicleOnly: s.filters.fitsVehicleOnly } })),
}));

export function activeFilterCount(f: SearchFilters): number {
  return (f.categoryId ? 1 : 0) + f.origins.length + f.conditions.length + (f.inStockOnly ? 0 : 1);
}
