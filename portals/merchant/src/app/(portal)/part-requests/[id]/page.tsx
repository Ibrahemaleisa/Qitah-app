"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { QuoteForm } from "@/components/part-requests/QuoteForm";
import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, LoadState } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, errorText } from "@/lib/api";
import { formatDateTime, formatDue, formatSar } from "@/lib/format";
import { cityAr, CONDITION_AR, label, ORIGIN_AR } from "@/lib/labels";
import { ageAr, PREFERRED_CONDITION_AR, PREFERRED_ORIGIN_AR, QUOTE_STATUS_AR, QUOTE_TONE, REQUEST_STATUS_AR, type RequestDetail } from "@/lib/partRequests";
import { markLocalAction, useApi, useNow } from "@/lib/useApi";

export default function PartRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMerchant();
  const res = useApi<RequestDetail>(`${m.base}/part-requests/${id}`, { refreshOn: ["part_request", "part_quote"] });
  const now = useNow(30_000);
  const r = res.data;

  return (
    <>
      <nav className="mb-3 text-sm">
        <Link href="/part-requests" className="text-brand underline">
          ← طلبات القطع
        </Link>
      </nav>
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {r && <RequestView r={r} now={now} reload={res.reload} />}
    </>
  );
}

function RequestView({ r, now, reload }: { r: RequestDetail; now: number; reload: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const q = r.myQuote;
  const open = (r.status === "OPEN" || r.status === "QUOTED") && new Date(r.expiresAt).getTime() > now;

  async function withdraw() {
    if (!window.confirm("سحب العرض؟ لن يراه العميل بعد الآن.")) return;
    setBusy(true);
    try {
      markLocalAction(r.id);
      await api(`${m.base}/part-requests/${r.id}/quote/withdraw`, { method: "POST", body: {} });
      toast({ tone: "success", title: "تم سحب العرض" });
      reload();
    } catch (e) {
      toast({ tone: "error", title: "تعذر سحب العرض", body: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-5">
      <section className="card p-5" data-testid="part-request-detail">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand">{r.vehicle.label.ar}</h1>
            <p className="mt-1 text-sm text-slate">
              <span className="ltr">{r.number}</span> · {ageAr(r.createdAt, now).text} · {cityAr(r.city)}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge tone={open ? "accent" : "neutral"}>{REQUEST_STATUS_AR[r.status]}</Badge>
            {open && <span className="text-xs text-muted">ينتهي: {formatDue(r.expiresAt, now).text}</span>}
          </div>
        </div>

        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <Info label="الوصف" wide>
            <p className="whitespace-pre-wrap">{r.description || "—"}</p>
          </Info>
          <Info label="رقم القطعة">{r.partNumber ? <span className="ltr">{r.partNumber}</span> : "—"}</Info>
          <Info label="الكمية">{r.quantity}</Info>
          <Info label="المحرك">{r.vehicle.engine ? <span className="ltr">{r.vehicle.engine}</span> : "—"}</Info>
          <Info label="رقم الهيكل (VIN)">{r.vehicle.vin ? <span className="ltr">{r.vehicle.vin}</span> : "—"}</Info>
          <Info label="الحالة المفضلة">{PREFERRED_CONDITION_AR[r.preferredCondition]}</Info>
          <Info label="المنشأ المفضل">{PREFERRED_ORIGIN_AR[r.preferredOrigin]}</Info>
          <Info label="مدينة التوصيل">{cityAr(r.city)}</Info>
        </dl>

        {r.photos.length > 0 && (
          <div className="mt-4">
            <p className="label">صور العميل</p>
            <div className="flex flex-wrap gap-3">
              {r.photos.map((p, i) => (
                <a key={p.url} href={p.url} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-lg border border-line">
                  {/* Signed, short-lived private URLs: next/image would cache them under a different origin. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={`صورة ${i + 1} من العميل`} className="h-36 w-36 object-cover" data-testid="request-photo" />
                </a>
              ))}
            </div>
          </div>
        )}
        <p className="mt-4 text-xs text-muted">بيانات العميل وعنوانه الكامل تظهر في الطلب بعد الدفع، وفق سياسة الطلبات.</p>
      </section>

      {q && !editing && (
        <section className="card p-5" data-testid="my-quote">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-bold text-brand">عرضك</h2>
            <Badge tone={QUOTE_TONE[q.status]}>{QUOTE_STATUS_AR[q.status]}</Badge>
          </div>
          <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Info label="القطعة">{q.product ? q.product.nameAr : q.partName ?? "—"}</Info>
            <Info label="العلامة / الرقم">
              <span className="ltr">{[q.brand, q.partNumber].filter(Boolean).join(" · ") || "—"}</span>
            </Info>
            <Info label="السعر">{formatSar(q.priceHalalas)}</Info>
            <Info label="الحالة">{label(CONDITION_AR, q.condition)}</Info>
            <Info label="المنشأ">{label(ORIGIN_AR, q.origin)}</Info>
            <Info label="الضمان">{q.warrantyMonths} شهر</Info>
            <Info label="التجهيز">{`${q.dispatchDays[0]}–${q.dispatchDays[1]} يوم`}</Info>
            <Info label="صالح حتى">{formatDateTime(q.validUntil)}</Info>
            {q.note && (
              <Info label="ملاحظة" wide>
                {q.note}
              </Info>
            )}
          </dl>
          {q.photoUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={q.photoUrl} alt="صورة القطعة المرفقة بعرضك" className="mt-3 h-28 w-28 rounded-lg border border-line object-cover" />
          )}
          {q.status === "ACCEPTED" && <p className="mt-3 rounded-lg bg-success-soft px-3 py-2 text-sm text-success">اختار العميل عرضك. سيظهر الطلب في «الطلبات» بعد الدفع.</p>}
          {q.status === "ACTIVE" && open && (
            <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
              <button type="button" className="btn btn-primary" onClick={() => setEditing(true)} data-testid="edit-quote">
                تعديل العرض
              </button>
              <button type="button" className="btn btn-danger" onClick={withdraw} disabled={busy}>
                سحب العرض
              </button>
            </div>
          )}
        </section>
      )}

      {open && (!q || editing) && (
        <QuoteForm
          request={r}
          onCancel={editing ? () => setEditing(false) : undefined}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {!open && !q && <p className="card p-5 text-sm text-slate">هذا الطلب لم يعد يستقبل عروضاً.</p>}
    </div>
  );
}

function Info({ label: l, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-4" : ""}>
      <dt className="text-xs text-slate">{l}</dt>
      <dd className="mt-0.5 font-medium">{children}</dd>
    </div>
  );
}
