'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { statusLabel } from '@/lib/labels';
import { EXCEPTION_STATUSES } from '@/lib/states';
import type { LiveEvent } from '@/lib/types';

import { useToast } from './Toasts';

/**
 * Realtime: one SSE connection per tab to /api/proxy/v1/events/stream?scope=ops (streamed by the BFF).
 * Uses fetch + a small SSE parser so every named event type is received. Subscribers get each event;
 * while the stream is down they get a synthetic `poll` tick every 20 s (polling fallback).
 */
export const POLL_MS = 20_000;
export type LiveMessage = LiveEvent | { type: 'poll' };
type Listener = (e: LiveMessage) => void;
type Ctx = { connected: boolean; recent: LiveEvent[]; subscribe: (l: Listener) => () => void };

const LiveCtx = createContext<Ctx>({ connected: false, recent: [], subscribe: () => () => undefined });
export const useLiveStatus = () => {
  const { connected, recent } = useContext(LiveCtx);
  return { connected, recent };
};

/** Calls `onEvent` for matching live events (and on every poll tick while SSE is down). */
export function useLive(onEvent: (e: LiveMessage) => void, match?: (e: LiveEvent) => boolean) {
  const { subscribe } = useContext(LiveCtx);
  const ref = useRef({ onEvent, match });
  useEffect(() => {
    ref.current = { onEvent, match };
  });
  useEffect(
    () =>
      subscribe((e) => {
        if (e.type === 'poll' || !ref.current.match || ref.current.match(e as LiveEvent)) ref.current.onEvent(e);
      }),
    [subscribe],
  );
}

function parseBlock(block: string): { event?: string; data: string } | null {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (!line || line.startsWith(':')) continue;
    const i = line.indexOf(':');
    const field = i === -1 ? line : line.slice(0, i);
    const value = i === -1 ? '' : line.slice(i + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  return data.length || event ? { event, data: data.join('\n') } : null;
}

export function LiveEventsProvider({ children }: { children: React.ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);
  const [recent, setRecent] = useState<LiveEvent[]>([]);
  const { push } = useToast();
  const pushRef = useRef(push);
  useEffect(() => {
    pushRef.current = push;
  });

  useEffect(() => {
    let stopped = false;
    let ctrl: AbortController | null = null;
    let retry = 0;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const emit = (e: LiveMessage) => listeners.current.forEach((l) => l(e));

    const onEvent = (e: LiveEvent) => {
      setRecent((r) => [e, ...r].slice(0, 60));
      emit(e);
      const status = typeof e.payload?.status === 'string' ? e.payload.status : undefined;
      if (e.type === 'shipment.updated' && status && (EXCEPTION_STATUSES as string[]).includes(status)) {
        pushRef.current({ tone: 'danger', title: 'استثناء شحن', body: statusLabel('shipment', status), href: `/tower/shipments/${e.entityId}` });
      } else if (e.type === 'refund.failed' || e.type === 'payment.failed') {
        pushRef.current({ tone: 'warning', title: e.type === 'refund.failed' ? 'فشل استرداد' : 'فشل دفع', href: e.orderId ? `/orders/${e.orderId}` : undefined });
      }
    };

    async function connect() {
      ctrl = new AbortController();
      try {
        const res = await fetch('/api/proxy/v1/events/stream?scope=ops', { headers: { accept: 'text/event-stream' }, signal: ctrl.signal, cache: 'no-store' });
        if (res.status === 401) {
          stopped = true;
          return;
        }
        if (!res.ok || !res.body) throw new Error(`SSE ${res.status}`);
        const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
        let buf = '';
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += value.replace(/\r\n/g, '\n');
          let idx;
          while ((idx = buf.indexOf('\n\n')) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx + 2);
            const msg = parseBlock(block);
            if (!msg) continue;
            if (msg.event === 'ready') {
              if (retry > 0) emit({ type: 'poll' }); // catch up on anything missed while disconnected
              retry = 0;
              setConnected(true);
              continue;
            }
            try {
              onEvent(JSON.parse(msg.data) as LiveEvent);
            } catch {
              /* ignore malformed event */
            }
          }
        }
        throw new Error('SSE closed');
      } catch {
        if (stopped) return;
        setConnected(false);
        retry += 1;
        retryTimer = setTimeout(connect, Math.min(60_000, 2_000 * 2 ** Math.min(retry, 5)));
      }
    }
    connect();

    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      ctrl?.abort();
    };
  }, []);

  // Polling fallback while the stream is down.
  useEffect(() => {
    if (connected) return;
    const t = setInterval(() => listeners.current.forEach((l) => l({ type: 'poll' })), POLL_MS);
    return () => clearInterval(t);
  }, [connected]);

  const subscribe = useCallback((l: Listener) => {
    listeners.current.add(l);
    return () => {
      listeners.current.delete(l);
    };
  }, []);
  const value = useMemo<Ctx>(() => ({ connected, recent, subscribe }), [connected, recent, subscribe]);
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}
