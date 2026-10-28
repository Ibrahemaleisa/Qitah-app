import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';

import { toApiError } from '@/api/client';
import { useCatalogVersion } from '@/catalog/remote-catalog';
import { isRemote } from '@/config/env';
import { emptyInterpretation, searchWithFallback, type ProductListing, type SearchInput, type SearchInterpretation, type SearchMode } from '@/services/catalog';
import { mergePages, remoteSearch, type RemoteSearchPage } from '@/services/remote/search';

/**
 * One search hook for both modes.
 * - Demo mode: the shared lexicon + parser run locally on the bundled catalog (synchronous).
 * - Remote mode: `GET /v1/catalog/search`, debounced while typing, the superseded request cancelled
 *   (AbortController), with loading / error / load-more states. The previous results stay visible
 *   while the next ones load. Nothing is fetched while browsing (empty query and no category).
 */

export type CatalogSearchState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  fits: ProductListing[];
  others: ProductListing[];
  hiddenOthers: number;
  total: number;
  mode: SearchMode;
  correctedQuery?: string;
  partNumberQuery: boolean;
  interpretation: SearchInterpretation;
  error: { code: string; message: string } | null;
  hasMore: boolean;
  loadingMore: boolean;
  loadMore: () => void;
  retry: () => void;
};

export const SEARCH_DEBOUNCE_MS = 300;

const noop = () => {};

function useLocalSearch(input: SearchInput): CatalogSearchState {
  const query = useDeferredValue(input.query);
  const catalogVersion = useCatalogVersion();
  const { filters, sort, vehicle } = input;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- catalogVersion re-runs the search after a catalog refresh
  const outcome = useMemo(() => searchWithFallback({ query, filters, sort, vehicle }), [query, filters, sort, vehicle, catalogVersion]);
  return { status: 'ready', ...outcome, error: null, hasMore: false, loadingMore: false, loadMore: noop, retry: noop };
}

/** Identifies one remote request; results are kept per key so state is derived, never reset in an effect. */
function requestKey(input: SearchInput, extra: string | number = ''): string {
  const v = input.vehicle;
  return JSON.stringify([input.query.trim(), input.filters, input.sort, v ? [v.modelId, v.year, v.engine] : null, extra]);
}

type Settled = { key: string; page: RemoteSearchPage | null; error: CatalogSearchState['error'] };

function useRemoteSearch(input: SearchInput): CatalogSearchState {
  const active = input.query.trim().length > 0 || !!input.filters.categoryId;
  const [attempt, setAttempt] = useState(0);
  const key = active ? requestKey(input, attempt) : null;
  const [settled, setSettled] = useState<Settled | null>(null);
  const [moreFor, setMoreFor] = useState<string | null>(null);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });

  useEffect(() => {
    if (!key) return;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      remoteSearch(latest.current, { signal: ac.signal })
        .then((page) => {
          if (!ac.signal.aborted) setSettled({ key, page, error: null });
        })
        .catch((e) => {
          const err = toApiError(e);
          if (ac.signal.aborted || err.code === 'ABORTED') return;
          setSettled((prev) => ({ key, page: prev?.page ?? null, error: { code: String(err.code), message: err.message } }));
        });
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [key]);

  const current = key && settled?.key === key ? settled : null;
  // While the next request runs, keep showing the last results (stale) instead of flashing an empty list.
  const page = key ? (current?.page ?? settled?.page ?? null) : null;
  const status: CatalogSearchState['status'] = !key ? 'idle' : !current ? 'loading' : current.error ? 'error' : 'ready';
  const loadingMore = !!key && moreFor === key;

  const loadMore = useCallback(() => {
    if (!key || !current?.page?.nextCursor || moreFor === key) return;
    const cursor = current.page.nextCursor;
    setMoreFor(key);
    remoteSearch(latest.current, { cursor })
      .then((next) => setSettled((s) => (s && s.key === key && s.page ? { ...s, page: mergePages(s.page, next) } : s)))
      .catch(() => {})
      .finally(() => setMoreFor((m) => (m === key ? null : m)));
  }, [key, current, moreFor]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return {
    status,
    fits: page?.fits ?? [],
    others: page?.others ?? [],
    hiddenOthers: page?.hiddenOthers ?? 0,
    total: page?.total ?? 0,
    mode: page?.mode ?? 'exact',
    correctedQuery: page?.correctedQuery,
    partNumberQuery: page?.partNumberQuery ?? false,
    interpretation: page?.interpretation ?? emptyInterpretation(),
    error: current?.error ?? null,
    hasMore: status === 'ready' && !!page?.nextCursor,
    loadingMore,
    loadMore,
    retry,
  };
}

/** `isRemote` is a build-time constant, so each build always calls the same hook. */
export const useCatalogSearch: (input: SearchInput) => CatalogSearchState = isRemote ? useRemoteSearch : useLocalSearch;

/** Result count for the filter sheet's "Show N results" button (null while unknown in remote mode). */
export function useSearchCount(input: SearchInput): number | null {
  const local = useMemo(() => (isRemote ? null : searchWithFallback(input).total), [input]);
  const key = isRemote ? requestKey(input, 'count') : null;
  const [remote, setRemote] = useState<{ key: string; total: number } | null>(null);
  const latest = useRef(input);
  useEffect(() => {
    latest.current = input;
  });
  useEffect(() => {
    if (!key) return;
    const ac = new AbortController();
    const timer = setTimeout(() => {
      remoteSearch(latest.current, { limit: 1, signal: ac.signal })
        .then((p) => {
          if (!ac.signal.aborted) setRemote({ key, total: p.total });
        })
        .catch(() => {});
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [key]);
  if (!isRemote) return local;
  return remote && remote.key === key ? remote.total : null;
}
