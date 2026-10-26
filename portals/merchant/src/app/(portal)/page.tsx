"use client";

import Link from "next/link";

import { useMerchant } from "@/components/portal/MerchantContext";
import { StatusPanel } from "@/components/portal/StatusPanel";
import { Badge, EmptyState, LoadState, PageHeader, Stat, StatusBadge } from "@/components/ui/bits";
import { cityAr, ORDER_STATUS_AR } from "@/lib/labels";
import { formatDue, formatInt, formatSar, percent } from "@/lib/format";
import type { Dashboard, MerchantOrder, Paged } from "@/lib/types";
import { useApi, useNow } from "@/lib/useApi";

const ORDER_EVENTS = ["order.paid", "merchant_order", "return", "offer", "shipment"];

export default function DashboardPage() {
  const m = useMerchant();
  const dash = useApi<Dashboard>(`${m.base}/dashboard`, { refreshOn: ORDER_EVENTS });
  const urgent = useApi<Paged<MerchantOrder>>(`${m.base}/orders?status=NEW,ACCEPTED,PACKING&limit=8`, { refreshOn: ORDER_EVENTS });
  const now = useNow();

  if (m.status !== "APPROVED") {
    return (
      <>
        <PageHeader title={`مرحباً، ${m.displayName}`} />
        <StatusPanel />
      </>
    );
  }

  const d = dash.data;
  return (
    <>
      <PageHeader title="الرئيسية" description="ما يحتاج إلى إجراء الآن في متجرك." />
      <LoadState loading={dash.loading} error={dash.error} onRetry={dash.reload} />
      {d && (
        <div className="space-y-6">
          <section aria-labelledby="queue-h">
            <h2 id="queue-h" className="mb-2 text-sm font-semibold text-slate">
              قائمة العمل
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="طلبات جديدة بانتظار القبول" value={formatInt(d.queue.new)} href="/orders?status=NEW" tone={d.queue.new ? "accent" : "default"} testId="queue-new" />
              <Stat label="مقبولة — ابدأ التجهيز" value={formatInt(d.queue.accepted)} href="/orders?status=ACCEPTED" testId="queue-accepted" />
              <Stat label="قيد التجهيز" value={formatInt(d.queue.packing)} href="/orders?status=PACKING" testId="queue-packing" />
              <Stat label="جاهزة لاستلام المندوب" value={formatInt(d.queue.readyForPickup)} href="/orders?status=READY_FOR_PICKUP" testId="queue-ready" />
            </div>
          </section>

          <section aria-labelledby="urgent-h" className="card">
            <div className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="urgent-h" className="font-bold">
                طلبات تحتاج إجراء
              </h2>
              <Link href="/orders" className="text-sm font-semibold text-brand underline">
                كل الطلبات
              </Link>
            </div>
            {urgent.data && urgent.data.items.length === 0 && <p className="px-4 py-6 text-sm text-slate">لا توجد طلبات مفتوحة الآن.</p>}
            {urgent.data && urgent.data.items.length > 0 && (
              <ul className="divide-y divide-line">
                {urgent.data.items.map((o) => {
                  const due = o.status === "NEW" ? o.acceptBy : o.readyBy;
                  const sla = due ? formatDue(due, now) : null;
                  return (
                    <li key={o.id}>
                      <Link href={`/orders/${o.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-mist">
                        <span className="ltr font-semibold">{o.number}</span>
                        <StatusBadge status={o.status} labels={ORDER_STATUS_AR} />
                        <span className="text-sm text-slate">
                          {o.items.length} صنف · {cityAr(o.order.addressSnapshot.city)}
                        </span>
                        {sla && (
                          <Badge tone={sla.overdue || o.slaBreached ? "danger" : sla.soon ? "warning" : "neutral"} className="ms-auto">
                            {o.status === "NEW" ? "القبول" : "التجهيز"}: {sla.text}
                          </Badge>
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="ops-h">
            <h2 id="ops-h" className="mb-2 text-sm font-semibold text-slate">
              المتجر
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="مرتجعات مفتوحة" value={formatInt(d.openReturns)} href={m.can("returns") ? "/returns" : undefined} tone={d.openReturns ? "accent" : "default"} />
              <Stat label="عروض منخفضة المخزون" value={formatInt(d.lowStockOffers)} href="/catalog" hint="المتاح 2 أو أقل" tone={d.lowStockOffers ? "danger" : "default"} />
              <Stat label="عروض نشطة" value={formatInt(d.activeOffers)} href="/catalog" />
              <Stat label="مع شركة الشحن" value={formatInt(d.queue.handedOver)} href="/orders?status=HANDED_OVER" />
            </div>
          </section>

          <section aria-labelledby="perf-h">
            <h2 id="perf-h" className="mb-2 text-sm font-semibold text-slate">
              الأداء
            </h2>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <Stat label="طلبات تم توصيلها" value={formatInt(d.performance.deliveredOrders)} />
              <Stat label="تجاوزات مهلة التنفيذ" value={formatInt(d.performance.slaBreaches)} tone={d.performance.slaBreaches ? "danger" : "default"} />
              <Stat label="نسبة الرفض" value={percent(d.performance.rejectionRate)} />
              {m.can("balance") ? (
                <Stat label="الرصيد المستحق لك" value={formatSar(d.balance.payableHalalas)} href="/settlements" hint={`تم تحويل ${formatSar(d.balance.paidOutHalalas)}`} testId="balance" />
              ) : (
                <div className="hidden md:block" />
              )}
            </div>
          </section>

          {d.activeOffers === 0 && m.can("catalog.edit") && (
            <EmptyState
              title="لا توجد عروض نشطة بعد"
              body="أضف أول عرض لتظهر قطعك للعملاء."
              action={
                <Link href="/catalog/new" className="btn btn-primary">
                  إضافة عرض
                </Link>
              }
            />
          )}
        </div>
      )}
    </>
  );
}
