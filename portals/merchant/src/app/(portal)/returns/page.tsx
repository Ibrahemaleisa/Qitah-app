"use client";

import { useState, type FormEvent } from "react";

import { ShipmentCard } from "@/components/orders/ShipmentCard";
import { useMerchant } from "@/components/portal/MerchantContext";
import { Dialog } from "@/components/ui/Dialog";
import { EmptyState, ErrorNote, Field, Forbidden, LoadState, PageHeader, StatusBadge } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, errorText } from "@/lib/api";
import { formatDateTime, formatSar, halalasToInput, parseSarToHalalas } from "@/lib/format";
import { label, RETURN_REASON_AR, RETURN_STATUS_AR } from "@/lib/labels";
import type { ReturnCase } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const FILTERS = [
  { key: "open", label: "مفتوحة", match: ["REQUESTED", "APPROVED", "IN_TRANSIT", "RECEIVED"] },
  { key: "REQUESTED", label: "بانتظار قرارك", match: ["REQUESTED"] },
  { key: "RECEIVED", label: "بانتظار الفحص", match: ["RECEIVED"] },
  { key: "done", label: "منتهية", match: ["REJECTED", "REFUNDED", "CLOSED"] },
  { key: "all", label: "الكل", match: [] as string[] },
];

type Dlg = { kind: "approve" | "reject" | "inspect"; rc: ReturnCase } | null;

export default function ReturnsPage() {
  const m = useMerchant();
  const toast = useToast();
  const res = useApi<{ items: ReturnCase[] }>(m.can("returns") ? `${m.base}/returns` : null, { refreshOn: ["return", "refund"] });
  const [filter, setFilter] = useState("open");
  const [dlg, setDlg] = useState<Dlg>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!m.can("returns")) return <Forbidden />;

  const f = FILTERS.find((x) => x.key === filter)!;
  const items = (res.data?.items ?? []).filter((r) => !f.match.length || f.match.includes(r.status));

  async function receive(rc: ReturnCase) {
    setBusy(rc.id);
    try {
      await api(`${m.base}/returns/${rc.id}/receive`, { method: "POST", body: {} });
      toast({ tone: "success", title: "تم تسجيل استلام المرتجع", body: rc.number });
      res.reload();
    } catch (e) {
      toast({ tone: "error", title: "تعذر التحديث", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="المرتجعات" description="قرّر في طلبات الإرجاع، سجّل الاستلام، ثم افحص القطعة لإتمام الاسترداد." />
      <div role="tablist" className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {FILTERS.map((x) => (
          <button
            key={x.key}
            role="tab"
            type="button"
            aria-selected={x.key === filter}
            onClick={() => setFilter(x.key)}
            className={`-mb-px shrink-0 border-b-2 px-3 py-2 text-sm font-semibold ${x.key === filter ? "border-brand text-brand" : "border-transparent text-slate"}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {res.data && items.length === 0 && <EmptyState title="لا توجد مرتجعات هنا" />}
      <div className="space-y-3">
        {items.map((rc) => {
          const value = rc.items.reduce((s, i) => s + i.orderItem.unitPriceHalalas * i.quantity, 0);
          return (
            <article key={rc.id} className="card p-4" data-testid="return-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="flex flex-wrap items-center gap-2 font-bold">
                    <span className="ltr">{rc.number}</span>
                    <StatusBadge status={rc.status} labels={RETURN_STATUS_AR} />
                  </h2>
                  <p className="text-sm text-slate">
                    الطلب <span className="ltr">{rc.merchantOrder.number}</span> · {formatDateTime(rc.createdAt)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {rc.status === "REQUESTED" && (
                    <>
                      <button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ kind: "approve", rc })}>
                        موافقة
                      </button>
                      <button type="button" className="btn btn-danger btn-sm" onClick={() => setDlg({ kind: "reject", rc })}>
                        رفض
                      </button>
                    </>
                  )}
                  {(rc.status === "APPROVED" || rc.status === "IN_TRANSIT") && (
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy === rc.id} onClick={() => receive(rc)}>
                      تم استلام القطعة
                    </button>
                  )}
                  {rc.status === "RECEIVED" && rc.refunds.length === 0 && (
                    <button type="button" className="btn btn-primary btn-sm" onClick={() => setDlg({ kind: "inspect", rc })}>
                      نتيجة الفحص
                    </button>
                  )}
                </div>
              </div>
              <div className="mt-3 grid gap-3 text-sm md:grid-cols-2">
                <div>
                  <p>
                    <strong>السبب:</strong> {label(RETURN_REASON_AR, rc.reason)}
                  </p>
                  {rc.customerNote && (
                    <p className="mt-1">
                      <strong>ملاحظة العميل:</strong> {rc.customerNote}
                    </p>
                  )}
                  {rc.decisionNote && (
                    <p className="mt-1">
                      <strong>ملاحظة القرار:</strong> {rc.decisionNote}
                    </p>
                  )}
                  {rc.inspectionNote && (
                    <p className="mt-1">
                      <strong>نتيجة الفحص:</strong> {rc.inspectionNote}
                    </p>
                  )}
                  <ul className="mt-2 space-y-0.5">
                    {rc.items.map((i) => (
                      <li key={i.id}>
                        {i.orderItem.productNameAr} <span className="ltr text-slate">({i.orderItem.partNumber})</span> × {i.quantity} — {formatSar(i.orderItem.unitPriceHalalas * i.quantity)}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-slate">قيمة القطع المرتجعة: {formatSar(value)}</p>
                  {rc.refunds.map((r) => (
                    <p key={r.id} className="mt-1">
                      <strong>استرداد:</strong> {formatSar(r.amountHalalas)} — {r.status === "SUCCEEDED" ? "تم" : r.status === "FAILED" ? "فشل" : "قيد التنفيذ"}
                      {rc.restock ? " · أُعيدت للمخزون" : ""}
                    </p>
                  ))}
                </div>
                {rc.shipments.length > 0 && (
                  <div className="space-y-2">
                    {rc.shipments.map((s) => (
                      <ShipmentCard key={s.id} s={{ ...s, events: s.events ?? [] }} />
                    ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
      {dlg && <ReturnDialog dlg={dlg} onClose={() => setDlg(null)} onDone={res.reload} />}
    </>
  );
}

function ReturnDialog({ dlg, onClose, onDone }: { dlg: NonNullable<Dlg>; onClose: () => void; onDone: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const { rc, kind } = dlg;
  const value = rc.items.reduce((s, i) => s + i.orderItem.unitPriceHalalas * i.quantity, 0);
  const [note, setNote] = useState("");
  const [accept, setAccept] = useState(true);
  const [restock, setRestock] = useState(true);
  const [partial, setPartial] = useState(false);
  const [amount, setAmount] = useState(halalasToInput(value));
  const [error, setError] = useState<unknown>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setFieldError(null);
    let body: Record<string, unknown> = {};
    if (kind === "approve") body = note.trim() ? { note: note.trim() } : {};
    if (kind === "reject") {
      if (note.trim().length < 2) return setFieldError("اذكر سبب الرفض للعميل");
      body = { note: note.trim() };
    }
    if (kind === "inspect") {
      body = { accept, ...(note.trim() ? { note: note.trim() } : {}) };
      if (accept) {
        body.restock = restock;
        if (partial) {
          const h = parseSarToHalalas(amount);
          if (!h || h > value) return setFieldError(`أدخل مبلغاً بين 0.01 و ${halalasToInput(value)}`);
          body.refundHalalas = h;
        }
      }
    }
    setBusy(true);
    setError(null);
    try {
      await api(`${m.base}/returns/${rc.id}/${kind}`, { method: "POST", body });
      toast({ tone: "success", title: kind === "approve" ? "تمت الموافقة على الإرجاع" : kind === "reject" ? "تم رفض الإرجاع" : "تم تسجيل نتيجة الفحص", body: rc.number });
      onDone();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const title = kind === "approve" ? `الموافقة على ${rc.number}` : kind === "reject" ? `رفض ${rc.number}` : `فحص ${rc.number}`;
  return (
    <Dialog open onClose={onClose} title={title}>
      <form onSubmit={submit} noValidate className="space-y-4">
        {kind === "approve" && <p className="text-sm text-slate">ستُنشأ شحنة إرجاع ويرتب فريق قطعة استلام القطعة من العميل.</p>}
        {kind === "inspect" && (
          <>
            <fieldset className="space-y-2 text-sm">
              <legend className="label">نتيجة الفحص</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="accept" checked={accept} onChange={() => setAccept(true)} /> القطعة سليمة ومطابقة — استرداد للعميل
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="accept" checked={!accept} onChange={() => setAccept(false)} /> لم تجتز الفحص — إغلاق بدون استرداد
              </label>
            </fieldset>
            {accept && (
              <>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> إعادة القطعة إلى المخزون
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} /> استرداد جزئي (الافتراضي كامل القيمة {formatSar(value)})
                </label>
                {partial && (
                  <Field label="مبلغ الاسترداد (ر.س)" required error={fieldError ?? undefined}>
                    {(p) => <input {...p} className="input ltr text-start" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />}
                  </Field>
                )}
              </>
            )}
          </>
        )}
        <Field label={kind === "reject" ? "سبب الرفض" : "ملاحظة (اختياري)"} required={kind === "reject"} error={kind !== "inspect" ? (fieldError ?? undefined) : undefined}>
          {(p) => <textarea {...p} className="textarea" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}
        </Field>
        <ErrorNote error={error} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="submit" className={`btn ${kind === "reject" ? "btn-danger" : "btn-primary"}`} disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "تأكيد"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
