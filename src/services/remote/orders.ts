import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';

import { toApiError } from '@/api/client';
import { meApi, ordersApi, type ReturnRequestInput } from '@/api/endpoints';
import type { ApiNotification, ApiOrder, RemotePaymentMethod } from '@/api/types';

import { toOrderView, type OrderView } from './orderView';
import { activeOrgId, useWorkshop } from './workshop';

/** Server orders and notifications (remote mode). Not persisted: always re-read from the API. */

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

type RemoteOrdersState = {
  list: ApiOrder[];
  listState: LoadState;
  listError: { code: string; message: string } | null;
  byId: Record<string, ApiOrder>;
  notifications: ApiNotification[];
  notificationsState: LoadState;
};

export const useRemoteOrders = create<RemoteOrdersState>()(() => ({
  list: [],
  listState: 'idle',
  listError: null,
  byId: {},
  notifications: [],
  notificationsState: 'idle',
}));

// Retail ↔ workshop switch: the list belongs to the previous mode, drop it (re-read on the orders screen's next focus).
useWorkshop.subscribe((s, prev) => {
  if (s.activeOrgId !== prev.activeOrgId) useRemoteOrders.setState({ list: [], listState: 'idle', listError: null });
});

function storeOrder(o: ApiOrder) {
  useRemoteOrders.setState((s) => ({
    byId: { ...s.byId, [o.id]: o },
    list: s.list.some((x) => x.id === o.id) ? s.list.map((x) => (x.id === o.id ? o : x)) : [o, ...s.list],
  }));
}

/** Retail mode: the customer's own orders. Workshop mode: every order of the active organisation. */
export async function fetchOrders() {
  useRemoteOrders.setState((s) => ({ listState: s.list.length ? s.listState : 'loading' }));
  const orgId = activeOrgId();
  try {
    const { orders } = await ordersApi.list(orgId ?? undefined);
    // The user switched mode while this was in flight: drop the stale list.
    if (activeOrgId() !== orgId) return;
    useRemoteOrders.setState((s) => ({ list: orders, listState: 'ready', listError: null, byId: { ...s.byId, ...Object.fromEntries(orders.map((o) => [o.id, o])) } }));
  } catch (e) {
    const err = toApiError(e);
    useRemoteOrders.setState({ listState: 'error', listError: { code: String(err.code), message: err.message } });
    throw err;
  }
}

export async function fetchOrder(id: string): Promise<ApiOrder> {
  const o = await ordersApi.get(id);
  storeOrder(o);
  return o;
}

export async function cancelOrder(id: string, reason: string) {
  storeOrder(await ordersApi.cancel(id, reason));
}

export async function requestReturn(id: string, input: ReturnRequestInput) {
  storeOrder(await ordersApi.requestReturn(id, input));
}

export async function retryPayment(id: string, method: RemotePaymentMethod) {
  const p = await ordersApi.retryPayment(id, method);
  await fetchOrder(id).catch(() => {});
  return p;
}

export async function fetchNotifications() {
  useRemoteOrders.setState((s) => ({ notificationsState: s.notifications.length ? s.notificationsState : 'loading' }));
  try {
    const { notifications } = await meApi.notifications();
    useRemoteOrders.setState({ notifications, notificationsState: 'ready' });
  } catch (e) {
    useRemoteOrders.setState({ notificationsState: 'error' });
    throw toApiError(e);
  }
}

export function clearRemoteOrders() {
  useRemoteOrders.setState({ list: [], listState: 'idle', listError: null, byId: {}, notifications: [], notificationsState: 'idle' });
}

/** Order detail view-model with load / error / refresh. */
export function useRemoteOrder(id: string | undefined) {
  const raw = useRemoteOrders((s) => (id ? s.byId[id] : undefined));
  const [state, setState] = useState<LoadState>(raw ? 'ready' : 'idle');
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const refresh = useCallback(async () => {
    if (!id) return;
    if (!useRemoteOrders.getState().byId[id]) setState('loading');
    try {
      await fetchOrder(id);
      if (mounted.current) {
        setState('ready');
        setError(null);
      }
    } catch (e) {
      const err = toApiError(e);
      if (mounted.current) {
        setError({ code: String(err.code), message: err.message });
        setState(useRemoteOrders.getState().byId[id] ? 'ready' : 'error');
      }
    }
  }, [id]);
  useEffect(() => {
    // Deferred so the initial fetch never sets state synchronously inside the effect.
    const t = setTimeout(refresh, 0);
    return () => clearTimeout(t);
  }, [refresh]);
  const view: OrderView | undefined = useMemo(() => (raw ? toOrderView(raw) : undefined), [raw]);
  return { order: view, raw, state, error, refresh };
}
