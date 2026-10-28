"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { FreshnessBanner } from "@/components/catalog/FreshnessBanner";
import { EditOfferDialog, HistoryDialog, StockEditor } from "@/components/catalog/OfferTools";
import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, EmptyState, LoadState, PageHeader, Pager, StatusBadge } from "@/components/ui/bits";
import { formatDate, formatSar } from "@/lib/format";
import { CONDITION_AR, FRESHNESS_AR, label, OFFER_STATUS_AR } from "@/lib/labels";
import type { Offer, Paged } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const PAGE = 50;

export default function CatalogPage() {
  const m = useMerchant();
  const [q, setQ] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [offset, setOffset] = useState(0);
  const [editing, setEditing] = useState<Offer | null>(null);
  const [history, setHistory] = useState<Offer | null>(null);

  // Debounce the search box.
  useEffect(() => {
    const t = setTimeout(() => {
      setTerm(q.trim());
      setOffset(0);
    }, 300);
    return () => clearTimeout(t);
  }, [q]);

  const params = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
  if (term) params.set("q", term);
  if (status) params.set("status", status);
  const offers = useApi<Paged<Offer>>(`${m.base}/offers?${params}`, { refreshOn: ["offer", "order.paid", "merchant_order"] });
  const canEdit = m.can("catalog.edit");

  return (
    <>
      <PageHeader
        title="العروض والمخزون"
        description={canEdit ? "حدّث الكميات والأسعار وحالة العروض. المحجوز = كميات في طلبات لم تُشحن بعد." : "حدّث كميات المخزون. تعديل الأسعار والعروض متاح للمدير والمالك."}
        actions={
          canEdit && (
            <>
              <Link href="/catalog/import" className="btn btn-secondary">
                استيراد CSV
              </Link>
              <Link href="/catalog/new" className="btn btn-primary" data-testid="add-offer">
                إضافة عرض
              </Link>
            </>
          )
        }
      />

      <FreshnessBanner onConfirmed={offers.reload} />

      <div className="mb-4 flex flex-wrap gap-2">
        <label className="min-w-[14rem] flex-1">
          <span className="sr-only">بحث</span>
          <input type="search" className="input" placeholder="ابحث باسم القطعة أو رقمها أو SKU" value={q} onChange={(e) => setQ(e.target.value)} data-testid="offer-search" />
        </label>
        <label>
          <span className="sr-only">الحالة</span>
          <select
            className="select"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            <option value="">كل العروض (غير المؤرشفة)</option>
            <option value="ACTIVE">نشطة</option>
            <option value="PAUSED">موقوفة مؤقتاً</option>
            <option value="ARCHIVED">مؤرشفة</option>
          </select>
        </label>
      </div>

      <LoadState loading={offers.loading} error={offers.error} onRetry={offers.reload} />
      {offers.data && offers.data.items.length === 0 && (
        <EmptyState
          title={term || status ? "لا توجد نتائج مطابقة" : "لا توجد عروض بعد"}
          action={
            canEdit &&
            !term && (
              <Link href="/catalog/new" className="btn btn-primary">
                إضافة أول عرض
              </Link>
            )
          }
        />
      )}
      {offers.data && offers.data.items.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table" data-testid="offers-table">
            <thead>
              <tr>
                <th>القطعة</th>
                <th>SKU</th>
                <th>الفرع</th>
                <th>السعر</th>
                <th>المخزون</th>
                <th>الحالة</th>
                <th>
                  <span className="sr-only">إجراءات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {offers.data.items.map((o) => {
                const onHand = o.inventory?.onHand ?? 0;
                const reserved = o.inventory?.reserved ?? 0;
                const available = onHand - reserved;
                return (
                  <tr key={o.id} data-testid="offer-row" data-sku={o.sku}>
                    <td className="min-w-[14rem]">
                      <p className="font-medium">{o.product.nameAr}</p>
                      <p className="ltr text-start text-xs text-slate">
                        {o.product.brand} · {o.product.partNumber}
                      </p>
                      <p className="text-xs text-slate">{label(CONDITION_AR, o.condition)}</p>
                    </td>
                    <td className="ltr whitespace-nowrap text-start text-sm">{o.sku}</td>
                    <td className="text-sm">{o.location.name}</td>
                    <td className="whitespace-nowrap">
                      <p className="font-semibold">{formatSar(o.priceHalalas)}</p>
                      {o.compareAtHalalas && <p className="text-xs text-slate line-through">{formatSar(o.compareAtHalalas)}</p>}
                    </td>
                    <td className="min-w-[15rem]">
                      <div className="mb-1 flex flex-wrap gap-1.5 text-xs">
                        <span>
                          متاح <strong data-testid="available">{available}</strong>
                        </span>
                        <span className="text-slate">· محجوز {reserved}</span>
                        {available <= 2 && o.status === "ACTIVE" && <Badge tone="danger">منخفض</Badge>}
                      </div>
                      <StockEditor key={`${o.id}:${onHand}:${reserved}`} offer={o} onSaved={offers.reload} />
                    </td>
                    <td>
                      <StatusBadge status={o.status} labels={OFFER_STATUS_AR} />
                      {o.status === "ACTIVE" && o.freshness && o.freshness !== "fresh" && (
                        <div className="mt-1" data-testid="offer-freshness" data-freshness={o.freshness}>
                          <Badge tone={o.freshness === "hidden" ? "danger" : "warning"}>{label(FRESHNESS_AR, o.freshness)}</Badge>
                        </div>
                      )}
                      {o.lastConfirmedAt && <p className="mt-1 whitespace-nowrap text-xs text-slate">آخر تأكيد {formatDate(o.lastConfirmedAt)}</p>}
                    </td>
                    <td>
                      <div className="flex gap-1">
                        {canEdit && (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(o)}>
                            تعديل
                          </button>
                        )}
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setHistory(o)}>
                          السجل
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {offers.data && offers.data.total > PAGE && <Pager offset={offset} total={offers.data.total} onChange={setOffset} />}

      {editing && <EditOfferDialog offer={editing} onClose={() => setEditing(null)} onSaved={offers.reload} />}
      {history && <HistoryDialog offer={history} onClose={() => setHistory(null)} />}
    </>
  );
}
