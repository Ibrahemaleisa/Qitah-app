"use client";

import Link from "next/link";
import { useState } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, EmptyState, LoadState, PageHeader } from "@/components/ui/bits";
import { formatDateTime, formatDue, formatSar } from "@/lib/format";
import { cityAr } from "@/lib/labels";
import {
  ageAr,
  PREFERRED_CONDITION_AR,
  PREFERRED_ORIGIN_AR,
  QUOTE_STATUS_AR,
  QUOTE_TONE,
  REQUEST_STATUS_AR,
  type InboxResponse,
  type MyQuotesResponse,
} from "@/lib/partRequests";
import { useApi, useNow } from "@/lib/useApi";

const TABS = [
  { key: "open", label: "طلبات مفتوحة" },
  { key: "unanswered", label: "لم أقدّم عرضاً" },
  { key: "mine", label: "عروضي" },
  { key: "won", label: "عروض فازت" },
] as const;

type Tab = (typeof TABS)[number]["key"];

export default function PartRequestsPage() {
  const m = useMerchant();
  const [tab, setTab] = useState<Tab>("open");
  const now = useNow(30_000);
  const approved = m.status === "APPROVED";
  const inbox = useApi<InboxResponse>(approved && (tab === "open" || tab === "unanswered") ? `${m.base}/part-requests` : null, { refreshOn: ["part_request", "part_quote"] });
  const mine = useApi<MyQuotesResponse>(tab === "mine" || tab === "won" ? `${m.base}/part-quotes${tab === "won" ? "?status=ACCEPTED" : ""}` : null, { refreshOn: ["part_request", "part_quote", "order.paid"] });

  const requests = (inbox.data?.items ?? []).filter((r) => tab !== "unanswered" || !r.myQuote);

  return (
    <>
      <PageHeader
        title="طلبات القطع"
        description="عملاء لم يجدوا القطعة في الكتالوج يطلبونها بالوصف أو الصورة أو رقم القطعة. قدّم عرضك بسرعة: الهدف الرد خلال 15 دقيقة."
      />
      {!approved && <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">تظهر طلبات القطع بعد اعتماد متجرك.</p>}
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {TABS.map((x) => (
          <button
            key={x.key}
            role="tab"
            type="button"
            aria-selected={x.key === tab}
            onClick={() => setTab(x.key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${x.key === tab ? "border-brand text-brand" : "border-transparent text-slate"}`}
            data-testid={`tab-${x.key}`}
          >
            {x.label}
          </button>
        ))}
      </div>

      {(tab === "open" || tab === "unanswered") && (
        <>
          <LoadState loading={inbox.loading} error={inbox.error} onRetry={inbox.reload} />
          {inbox.data && (
            <p className="mb-3 text-xs text-muted" data-testid="match-rule">
              تظهر لك الطلبات المفتوحة في مدن فروعك ({inbox.data.scope.cities.map(cityAr).join("، ") || "—"})، أو لسيارات من ماركات تناسبها عروضك الحالية.
            </p>
          )}
          {inbox.data && requests.length === 0 && <EmptyState title="لا توجد طلبات مفتوحة الآن" body="سنرسل لك إشعاراً عند وصول طلب يناسب متجرك." />}
          <ul className="space-y-3">
            {requests.map((r) => {
              const age = ageAr(r.createdAt, now);
              const urgent = !r.firstQuotedAt && age.minutes < 15;
              return (
                <li key={r.id}>
                  <Link href={`/part-requests/${r.id}`} className="card block p-4 transition-colors hover:border-brand-600" data-testid="part-request-card">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 font-bold">
                          <span>{r.vehicle.label.ar}</span>
                          {r.vehicle.engine && <span className="ltr text-sm font-normal text-slate">{r.vehicle.engine}</span>}
                        </p>
                        <p className="mt-1 line-clamp-2 text-sm">{r.description || "—"}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {r.myQuote ? <Badge tone={QUOTE_TONE[r.myQuote.status]}>{QUOTE_STATUS_AR[r.myQuote.status]} · {formatSar(r.myQuote.priceHalalas)}</Badge> : <Badge tone={urgent ? "accent" : "neutral"}>{urgent ? "جديد — بلا عروض" : REQUEST_STATUS_AR[r.status]}</Badge>}
                        <span className="text-xs text-muted">{age.text}</span>
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      <Badge>{cityAr(r.city)}</Badge>
                      {r.partNumber && <Badge><span className="ltr">{r.partNumber}</span></Badge>}
                      {r.photoCount > 0 && <Badge tone="teal">{r.photoCount} صور</Badge>}
                      <Badge>{PREFERRED_CONDITION_AR[r.preferredCondition]}</Badge>
                      <Badge>{PREFERRED_ORIGIN_AR[r.preferredOrigin]}</Badge>
                      {r.quantity > 1 && <Badge>الكمية {r.quantity}</Badge>}
                      <span className="text-muted">ينتهي: {formatDue(r.expiresAt, now).text}</span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {(tab === "mine" || tab === "won") && (
        <>
          <LoadState loading={mine.loading} error={mine.error} onRetry={mine.reload} />
          {mine.data && mine.data.items.length === 0 && <EmptyState title={tab === "won" ? "لا توجد عروض فائزة بعد" : "لم تقدّم عروضاً بعد"} />}
          {mine.data && mine.data.items.length > 0 && (
            <div className="card overflow-x-auto">
              <table className="table w-full text-sm">
                <thead>
                  <tr>
                    <th>الطلب</th>
                    <th>السيارة</th>
                    <th>عرضك</th>
                    <th>الحالة</th>
                    <th>آخر تحديث</th>
                    <th>الطلب المدفوع</th>
                  </tr>
                </thead>
                <tbody>
                  {mine.data.items.map((q) => (
                    <tr key={q.id} data-testid="my-quote-row">
                      <td>
                        <Link href={`/part-requests/${q.request.id}`} className="ltr font-semibold text-brand underline">
                          {q.request.number}
                        </Link>
                      </td>
                      <td>{q.request.vehicle.label.ar}</td>
                      <td>
                        <span className="font-semibold">{formatSar(q.priceHalalas)}</span>
                        <span className="block text-xs text-slate">{q.partName ?? q.brand ?? ""}</span>
                      </td>
                      <td>
                        <Badge tone={QUOTE_TONE[q.status]}>{QUOTE_STATUS_AR[q.status]}</Badge>
                      </td>
                      <td>{formatDateTime(q.updatedAt)}</td>
                      <td>
                        {q.merchantOrders.length
                          ? q.merchantOrders.map((o) => (
                              <Link key={o.id} href={`/orders/${o.id}`} className="ltr block text-brand underline">
                                {o.number}
                              </Link>
                            ))
                          : q.won
                            ? <span className="text-xs text-slate">بانتظار دفع العميل</span>
                            : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
