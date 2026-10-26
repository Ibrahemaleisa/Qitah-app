'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { useLive } from '@/components/LiveEvents';
import { useToast } from '@/components/Toasts';

import { api } from './api';
import { errorMessage } from './errors';
import type { LiveEvent } from './types';

/**
 * GET an API path through the BFF. Keeps the previous data while reloading (no flicker),
 * and optionally reloads on matching live events (debounced) and on polling ticks.
 */
export function useApi<T>(path: string | null, opts: { live?: (e: LiveEvent) => boolean } = {}) {
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  const key = path ? `${path}#${version}` : null;
  const [res, setRes] = useState<{ key?: string; data?: T; error: string | null }>({ error: null });

  useEffect(() => {
    if (!path || !key) return;
    const ctrl = new AbortController();
    api<T>(path, { signal: ctrl.signal })
      .then((d) => setRes({ key, data: d, error: null }))
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setRes((r) => ({ ...r, key, error: errorMessage(e) }));
      });
    return () => ctrl.abort();
  }, [path, key]);

  const setData = useCallback((d: T) => setRes((r) => ({ ...r, data: d })), []);
  const { data, error } = res;
  const loading = !!key && res.key !== key;

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useLive(
    () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(reload, 400);
    },
    opts.live ?? (() => false),
  );
  useEffect(() => () => clearTimeout(timer.current), []);

  return { data, error, loading, reload, setData };
}

/** Runs a mutation with a pending flag and success / error toasts. */
export function useAction() {
  const { push } = useToast();
  const [pending, setPending] = useState<string | null>(null);
  const run = useCallback(
    async <R>(key: string, fn: () => Promise<R>, success?: string | ((r: R) => string)): Promise<R | undefined> => {
      setPending(key);
      try {
        const r = await fn();
        if (success) push({ tone: 'success', title: typeof success === 'function' ? success(r) : success });
        return r;
      } catch (e) {
        push({ tone: 'danger', title: 'تعذر تنفيذ الإجراء', body: errorMessage(e) });
        return undefined;
      } finally {
        setPending(null);
      }
    },
    [push],
  );
  return { run, pending };
}

/** Re-renders every `ms` so countdowns stay current. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function useDebounced<T>(value: T, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
