"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { OrderActions } from "@/components/orders/OrderActions";
import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, EmptyState, LoadState, PageHeader, Pager, StatusBadge } from "@/components/ui/bits";
import { formatDateTime, formatDue, formatSar } from "@/lib/format";
import { cityAr, ORDER_STATUS_AR } from "@/lib/labels";
import type { Dashboard, MerchantOrder, Paged } from "@/lib/types";
import { useApi, useNow } from "@/lib/useApi";

const TABS: { key: string; label: string; statuses: string; count?: keyof Dashboard["queue"] }[] = [
  { key: "NEW", label: "جديدة", statuses: "NEW", count: "new" },
  { key: "ACCEPTED", label: "مقبولة", statuses: "ACCEPTED", count: "accepted" },
  { key: "PACKING", label: "قيد التجهيز", statuses: "PACKING", count: "packing" },
  { key: "READY_FOR_PICKUP", label: "جاهزة للاستلام", statuses: "READY_FOR_PICKUP", count: "readyForPickup" },
  { key: "HANDED_OVER", label: "مع الشحن", statuses: "HANDED_OVER", count: "handedOver" },
  { key: "DELIVERED", label: "تم التوصيل", statuses: "DELIVERED" },
  { key: "CLOSED", label: "مرفوضة وملغاة", statuses: "REJECTED,CANCELLED" },
  { key: "ALL", label: "الكل", statuses: "" },
];

const EVENTS = ["order.paid", "merchant_order", "shipment"];
const PAGE = 50;

export default function OrdersPage() {
  return (
    <Suspense>
      <Orders />
    </Suspense>
  );
}

function Orders() {
  const m = useMerchant();
  const router = useRouter();
  const params = useSearchParams();
  const tabKey = TABS.some((t) => t.key === params.get("status")) ? params.get("status")! : "NEW";
  const tab = TABS.find((t) => t.key === tabKey)!;
  const [offset, setOffset] = useState(0);
  const path = `${m.base}/orders?limit=${PAGE}&offset=${offset}${tab.statuses ? `&status=${tab.statuses}` : ""}`;
  const orders = useApi<Paged<MerchantOrder>>(path, { refreshOn: EVENTS });
  const dash = useApi<Dashboard>(`${m.base}/dashboard`, { refreshOn: EVENTS });
  const now = useNow();

  return (
    <>
      <PageHeader title="الطلبات" description="اقبل الطلبات الجديدة قبل انتهاء مهلة القبول، ثم جهّزها وحدّدها جاهزة لاستلام المندوب." />
      <div role="tablist" aria-label="حالة الطلب" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((t) => {
          const count = t.count ? dash.data?.queue[t.count] : undefined;
          const active = t.key === tabKey;
          return (
            <button
              key={t.key}
              role="tab"
              type="button"
              aria-selected={active}
              onClick={() => {
                setOffset(0);
                router.replace(`/orders?status=${t.key}`, { scroll: false });
              }}
              className={`-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-semibold ${active ? "border-brand text-brand" : "border-transparent text-slate hover:text-ink"}`}
              data-testid={`tab-${t.key}`}
            >
              {t.label}
              {count !== undefined && count > 0 && <span className={`rounded-full px-1.5 text-xs ${t.key === "NEW" ? "bg-accent text-white" : "bg-mist text-slate"}`}>{count}</span>}
            </button>
          );
        })}
      </div>

      <LoadState loading={orders.loading} error={orders.error} onRetry={orders.reload} />
      {orders.data && orders.data.items.length === 0 && <EmptyState title="لا توجد طلبات هنا" body="ستظهر الطلبات الجديدة فور دفعها، مع تنبيه مباشر." />}
      {orders.data && orders.data.items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table" data-testid="orders-table">
            <thead>
              <tr>
                <th>رقم الطلب</th>
                <th>التاريخ</th>
                <th>الأصناف</th>
                <th>الوجهة</th>
                <th>قيمة القطع</th>
                <th>المهلة</th>
                <th>الحالة</th>
                <th>
                  <span className="sr-only">إجراءات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orders.data.items.map((o) => {
                const due = o.status === "NEW" ? o.acceptBy : o.status === "ACCEPTED" || o.status === "PACKING" ? o.readyBy : null;
                const sla = due ? formatDue(due, now) : null;
                return (
                  <tr key={o.id} data-testid="order-row" data-order-number={o.number}>
                    <td>
                      <Link href={`/orders/${o.id}`} className="ltr font-semibold text-brand underline-offset-2 hover:underline">
                        {o.number}
                      </Link>
                    </td>
                    <td className="whitespace-nowrap text-sm text-slate">{formatDateTime(o.order.paidAt ?? o.createdAt)}</td>
                    <td className="max-w-[18rem]">
                      <p className="truncate text-sm">{o.items.map((i) => `${i.productNameAr} ×${i.quantity}`).join("، ")}</p>
                    </td>
                    <td className="whitespace-nowrap text-sm">
                      {cityAr(o.order.addressSnapshot.city)}
                      {o.order.addressSnapshot.district ? ` — ${o.order.addressSnapshot.district}` : ""}
                    </td>
                    <td className="whitespace-nowrap">{formatSar(o.itemsHalalas)}</td>
                    <td className="whitespace-nowrap">
                      {sla ? <Badge tone={sla.overdue || o.slaBreached ? "danger" : sla.soon ? "warning" : "neutral"}>{sla.text}</Badge> : o.slaBreached ? <Badge tone="danger">تجاوز المهلة</Badge> : <span className="text-muted">—</span>}
                    </td>
                    <td>
                      <StatusBadge status={o.status} labels={ORDER_STATUS_AR} />
                    </td>
                    <td>
                      <OrderActions order={o} onDone={orders.reload} size="sm" />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {orders.data && orders.data.total > PAGE && (
        <Pager offset={offset} total={orders.data.total} onChange={setOffset} />
      )}
    </>
  );
}
