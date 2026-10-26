"use client";

import { useCallback, useEffect, useState } from "react";

import { api, ApiError } from "./api";

/** Realtime bus: the shell's event stream re-broadcasts API domain events as window events. */
export const EVENT_NAME = "qitah:event";
export type BusEvent = { type: string; entityId?: string; payload?: Record<string, unknown> };

export function publish(event: BusEvent) {
  window.dispatchEvent(new CustomEvent<BusEvent>(EVENT_NAME, { detail: event }));
}

export function useBus(handler: (e: BusEvent) => void, types: string[] | undefined) {
  const key = types?.join(",") ?? "";
  useEffect(() => {
    if (!key) return;
    const wanted = key.split(",");
    const listener = (ev: Event) => {
      const detail = (ev as CustomEvent<BusEvent>).detail;
      if (detail.type === "resync" || wanted.includes("*") || wanted.some((t) => detail.type === t || detail.type.startsWith(`${t}.`))) handler(detail);
    };
    window.addEventListener(EVENT_NAME, listener);
    return () => window.removeEventListener(EVENT_NAME, listener);
  }, [key, handler]);
}

type State<T> = { key: string; data?: T; error?: ApiError };

/**
 * Tiny data hook: GET `path` through the proxy, keep the last data while refetching, and refetch
 * when one of `refreshOn` realtime event types arrives (e.g. ["merchant_order", "order.paid"]).
 * Pass `null` to skip fetching.
 */
export function useApi<T>(path: string | null, opts: { refreshOn?: string[] } = {}) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<State<T>>({ key: "" });
  const key = path ? `${path}#${nonce}` : "";

  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    api<T>(path, { signal: ctrl.signal }).then(
      (data) => setState({ key: `${path}#${nonce}`, data }),
      (error: unknown) => {
        if ((error as Error)?.name === "AbortError") return;
        setState((s) => ({ key: `${path}#${nonce}`, data: s.key.startsWith(`${path}#`) ? s.data : undefined, error: error instanceof ApiError ? error : new ApiError(0, "NETWORK", String(error)) }));
      },
    );
    return () => ctrl.abort();
  }, [path, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useBus(reload, opts.refreshOn);

  const samePath = !!path && state.key.startsWith(`${path}#`);
  const data = samePath ? state.data : undefined;
  const error = samePath && state.key === key ? state.error : undefined;
  return {
    data,
    error,
    loading: !!path && !samePath,
    refreshing: !!path && state.key !== key,
    reload,
    /** Optimistic local update. */
    mutate: (fn: (d: T | undefined) => T | undefined) => setState((s) => ({ ...s, data: fn(s.data) })),
  };
}

/** Re-renders every `ms` (for SLA countdowns). */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}
