"use client";

import Link from "next/link";
import { useState } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { EmptyState, LoadState, PageHeader } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, errorText } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import type { Notification } from "@/lib/types";
import { publish, useApi } from "@/lib/useApi";

function linkFor(n: Notification): string | null {
  const d = n.data ?? {};
  if (typeof d.merchantOrderId === "string") return `/orders/${d.merchantOrderId}`;
  if (typeof d.returnCaseId === "string") return "/returns";
  if (n.type.startsWith("merchant.")) return "/store";
  return null;
}

export default function NotificationsPage() {
  const m = useMerchant();
  const toast = useToast();
  const res = useApi<{ notifications: Notification[] }>(`${m.base}/notifications`, { refreshOn: ["order.paid", "merchant_order", "return", "merchant"] });
  const [busy, setBusy] = useState(false);
  const unread = res.data?.notifications.filter((n) => !n.readAt).length ?? 0;

  async function markAll() {
    setBusy(true);
    try {
      await api(`${m.base}/notifications/read`, { method: "POST", body: {} });
      res.reload();
      publish({ type: "notifications.read" });
    } catch (e) {
      toast({ tone: "error", title: "تعذر التحديث", body: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="الإشعارات"
        description={unread ? `${unread} غير مقروءة` : "كل الإشعارات مقروءة"}
        actions={
          <button type="button" className="btn btn-secondary" disabled={!unread || busy} onClick={markAll} data-testid="mark-read">
            تحديد الكل كمقروء
          </button>
        }
      />
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {res.data && res.data.notifications.length === 0 && <EmptyState title="لا توجد إشعارات" />}
      {res.data && res.data.notifications.length > 0 && (
        <ul className="card divide-y divide-line">
          {res.data.notifications.map((n) => {
            const href = linkFor(n);
            const body = (
              <div className="flex items-start gap-3">
                <span className={`mt-2 inline-block h-2 w-2 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-accent"}`} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className={n.readAt ? "" : "font-bold"}>
                    {n.title}
                    {!n.readAt && <span className="sr-only"> (غير مقروء)</span>}
                  </p>
                  {n.body && <p className="text-sm text-slate">{n.body}</p>}
                </div>
                <time className="shrink-0 text-xs text-slate" dateTime={n.createdAt}>
                  {formatDateTime(n.createdAt)}
                </time>
              </div>
            );
            return (
              <li key={n.id} data-testid="notification">
                {href ? (
                  <Link href={href} className="block px-4 py-3 hover:bg-mist">
                    {body}
                  </Link>
                ) : (
                  <div className="px-4 py-3">{body}</div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
