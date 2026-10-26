"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { ORDER_STATUS_AR } from "@/lib/labels";
import type { DomainEvent } from "@/lib/types";
import { publish } from "@/lib/useApi";

import { useMerchant } from "./MerchantContext";

/** Event types the API emits to merchants (services/api/src/services/*.ts → emit()). */
const EVENT_TYPES = ["order.paid", "merchant_order.updated", "offer.updated", "return.updated", "shipment.updated", "merchant.updated", "merchant.applied", "refund.succeeded"];
const POLL_MS = 30_000;

export type RealtimeMode = "connecting" | "live" | "polling";
const ModeCtx = createContext<RealtimeMode>("connecting");
export const useRealtimeMode = () => useContext(ModeCtx);

/**
 * One EventSource per selected store on the BFF proxy's SSE pass-through. Every event is
 * re-published on the window bus (views refetch what they show). If the stream cannot be kept
 * open, falls back to polling GET /v1/events every 30 seconds from the last cursor.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { merchantId } = useMerchant();
  const toast = useToast();
  const [mode, setMode] = useState<RealtimeMode>("connecting");

  useEffect(() => {
    let stopped = false;
    let cursor: string | undefined;
    let errors = 0;
    let readyCount = 0;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    let es: EventSource | null = null;

    const handle = (e: DomainEvent) => {
      publish({ type: e.type, entityId: e.entityId, payload: e.payload });
      if (e.type === "order.paid") {
        toast({ tone: "info", title: "طلب جديد", body: "وصل طلب مدفوع بانتظار قبولك.", href: "/orders?status=NEW" });
      } else if (e.type === "merchant_order.updated") {
        const to = typeof e.payload?.to === "string" ? e.payload.to : undefined;
        toast({
          tone: to === "CANCELLED" ? "error" : "info",
          title: to === "CANCELLED" ? "تم إلغاء طلب" : "تحديث على طلب",
          body: to ? `الحالة الآن: ${ORDER_STATUS_AR[to] ?? to}` : undefined,
          href: `/orders/${e.entityId}`,
        });
      }
    };

    const poll = async () => {
      try {
        const r = await api<{ events: DomainEvent[]; cursor: string }>("/v1/events", { query: { scope: "merchant", merchantId, after: cursor } });
        if (cursor !== undefined) r.events.forEach(handle);
        cursor = r.cursor;
      } catch {
        // keep polling; a 401 already redirects to login
      }
      if (!stopped) pollTimer = setTimeout(poll, POLL_MS);
    };

    const startPolling = () => {
      if (stopped) return;
      es?.close();
      es = null;
      setMode("polling");
      publish({ type: "resync" });
      void poll();
    };

    if (typeof EventSource === "undefined") {
      startPolling();
    } else {
      es = new EventSource(`/api/proxy/v1/events/stream?scope=merchant&merchantId=${encodeURIComponent(merchantId)}`);
      es.addEventListener("ready", (ev) => {
        errors = 0;
        try {
          cursor = (JSON.parse((ev as MessageEvent).data) as { cursor?: string }).cursor ?? cursor;
        } catch {
          /* ignore */
        }
        setMode("live");
        // After an automatic reconnect we may have missed events: refetch what is on screen.
        if (++readyCount > 1) publish({ type: "resync" });
      });
      for (const type of EVENT_TYPES) {
        es.addEventListener(type, (ev) => {
          const msg = ev as MessageEvent;
          if (msg.lastEventId) cursor = msg.lastEventId;
          try {
            handle(JSON.parse(msg.data) as DomainEvent);
          } catch {
            /* malformed event: ignore */
          }
        });
      }
      es.onerror = () => {
        errors += 1;
        if (!es || es.readyState === EventSource.CLOSED || errors >= 3) startPolling();
      };
    }

    return () => {
      stopped = true;
      es?.close();
      if (pollTimer) clearTimeout(pollTimer);
    };
  }, [merchantId, toast]);

  return <ModeCtx.Provider value={mode}>{children}</ModeCtx.Provider>;
}
