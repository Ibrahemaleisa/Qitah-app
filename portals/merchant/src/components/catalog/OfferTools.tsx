"use client";

import { useState, type FormEvent } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNote, Field, LoadState } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { formatDateTime, halalasToInput, parseSarToHalalas, parseWhole } from "@/lib/format";
import { ADJUSTMENT_REASON_AR, label } from "@/lib/labels";
import type { Adjustment, Location, Offer } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/** Inline stock editor: sets on-hand (absolute) with a reason; refuses to go below reserved units. */
export function StockEditor({ offer, onSaved }: { offer: Offer; onSaved: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const reserved = offer.inventory?.reserved ?? 0;
  const [value, setValue] = useState(String(offer.inventory?.onHand ?? 0));
  const [reason, setReason] = useState("RESTOCK");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const current = offer.inventory?.onHand ?? 0;
  const parsed = parseWhole(value);
  const dirty = parsed !== current;

  async function save(e: FormEvent) {
    e.preventDefault();
    if (parsed === null) return setError("أدخل رقماً صحيحاً");
    if (parsed < reserved) return setError(`لا يمكن أن يقل عن المحجوز (${reserved})`);
    if (parsed > 100_000) return setError("الحد الأقصى 100,000");
    setBusy(true);
    setError(null);
    try {
      await api(`${m.base}/offers/${offer.id}/stock`, { method: "PUT", body: { onHand: parsed, reason } });
      toast({ tone: "success", title: "تم تحديث المخزون", body: `${offer.sku}: ${parsed}` });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.messageAr : "تعذر الحفظ");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="flex flex-wrap items-center gap-1.5" aria-label={`مخزون ${offer.sku}`}>
      <label className="sr-only" htmlFor={`stock-${offer.id}`}>
        الكمية في المخزون
      </label>
      <input
        id={`stock-${offer.id}`}
        className="input input-sm w-20"
        inputMode="numeric"
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
        aria-invalid={error ? true : undefined}
        data-testid="stock-input"
      />
      {dirty && (
        <>
          <label className="sr-only" htmlFor={`reason-${offer.id}`}>
            سبب التعديل
          </label>
          <select id={`reason-${offer.id}`} className="select input-sm w-auto" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="RESTOCK">إعادة تخزين</option>
            <option value="CORRECTION">تصحيح جرد</option>
            <option value="DAMAGE">تلف</option>
          </select>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy} data-testid="stock-save">
            {busy ? "…" : "حفظ"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="w-full text-xs text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

export function EditOfferDialog({ offer, onClose, onSaved }: { offer: Offer; onClose: () => void; onSaved: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const locations = useApi<{ locations: Location[] }>(`${m.base}/locations`);
  const [price, setPrice] = useState(halalasToInput(offer.priceHalalas));
  const [compareAt, setCompareAt] = useState(halalasToInput(offer.compareAtHalalas));
  const [status, setStatus] = useState(offer.status);
  const [locationId, setLocationId] = useState(offer.locationId);
  const [warranty, setWarranty] = useState(String(offer.warrantyMonths));
  const [dMin, setDMin] = useState(String(offer.dispatchDaysMin));
  const [dMax, setDMax] = useState(String(offer.dispatchDaysMax));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    const priceH = parseSarToHalalas(price);
    if (!priceH) errs.price = "سعر غير صحيح (مثال 125.50)";
    const compareH = compareAt.trim() ? parseSarToHalalas(compareAt) : null;
    if (compareAt.trim() && !compareH) errs.compareAt = "سعر غير صحيح";
    if (compareH && priceH && compareH <= priceH) errs.compareAt = "السعر قبل الخصم يجب أن يكون أعلى من السعر الحالي";
    const w = parseWhole(warranty);
    if (w === null || w > 120) errs.warranty = "من 0 إلى 120 شهراً";
    const a = parseWhole(dMin);
    const b = parseWhole(dMax);
    if (a === null || a > 30) errs.dMin = "من 0 إلى 30";
    if (b === null || b > 30) errs.dMax = "من 0 إلى 30";
    if (a !== null && b !== null && b < a) errs.dMax = "يجب أن يكون أكبر من أو يساوي الحد الأدنى";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError(null);
    try {
      await api(`${m.base}/offers/${offer.id}`, {
        method: "PATCH",
        body: { priceHalalas: priceH, compareAtHalalas: compareH, status, locationId, warrantyMonths: w, dispatchDaysMin: a, dispatchDaysMax: b },
      });
      toast({ tone: "success", title: "تم حفظ العرض", body: offer.sku });
      onSaved();
      onClose();
    } catch (err) {
      setServerError(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={`تعديل العرض ${offer.sku}`}>
      <form onSubmit={submit} className="space-y-4" noValidate>
        <p className="text-sm text-slate">{offer.product.nameAr}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="السعر (ر.س، شامل الضريبة)" required error={errors.price}>
            {(p) => <input {...p} className="input ltr text-start" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} />}
          </Field>
          <Field label="السعر قبل الخصم (اختياري)" error={errors.compareAt}>
            {(p) => <input {...p} className="input ltr text-start" inputMode="decimal" value={compareAt} onChange={(e) => setCompareAt(e.target.value)} />}
          </Field>
          <Field label="الحالة">
            {(p) => (
              <select {...p} className="select" value={status} onChange={(e) => setStatus(e.target.value as Offer["status"])}>
                <option value="ACTIVE">نشط — ظاهر للعملاء</option>
                <option value="PAUSED">موقوف مؤقتاً</option>
                <option value="ARCHIVED">مؤرشف</option>
              </select>
            )}
          </Field>
          <Field label="الفرع">
            {(p) => (
              <select {...p} className="select" value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                {(locations.data?.locations ?? [offer.location as unknown as Location])
                  .filter((l) => l.active !== false || l.id === offer.locationId)
                  .map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
              </select>
            )}
          </Field>
          <Field label="الضمان (شهر)" error={errors.warranty}>
            {(p) => <input {...p} className="input" inputMode="numeric" value={warranty} onChange={(e) => setWarranty(e.target.value)} />}
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="التجهيز من (يوم)" error={errors.dMin}>
              {(p) => <input {...p} className="input" inputMode="numeric" value={dMin} onChange={(e) => setDMin(e.target.value)} />}
            </Field>
            <Field label="إلى (يوم)" error={errors.dMax}>
              {(p) => <input {...p} className="input" inputMode="numeric" value={dMax} onChange={(e) => setDMax(e.target.value)} />}
            </Field>
          </div>
        </div>
        <ErrorNote error={serverError} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function HistoryDialog({ offer, onClose }: { offer: Offer; onClose: () => void }) {
  const m = useMerchant();
  const res = useApi<{ adjustments: Adjustment[] }>(`${m.base}/offers/${offer.id}/adjustments`, { refreshOn: ["offer"] });
  return (
    <Dialog open onClose={onClose} title={`سجل المخزون — ${offer.sku}`} wide>
      <LoadState loading={res.loading} error={res.error} />
      {res.data && res.data.adjustments.length === 0 && <p className="text-sm text-slate">لا توجد حركات بعد.</p>}
      {res.data && res.data.adjustments.length > 0 && (
        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>التاريخ</th>
                <th>السبب</th>
                <th>التغيير</th>
                <th>الرصيد بعد</th>
                <th>ملاحظة</th>
              </tr>
            </thead>
            <tbody>
              {res.data.adjustments.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-sm">{formatDateTime(a.createdAt)}</td>
                  <td className="text-sm">{label(ADJUSTMENT_REASON_AR, a.reason)}</td>
                  <td className={`ltr text-start font-semibold ${a.delta < 0 ? "text-danger" : "text-success"}`}>{a.delta > 0 ? `+${a.delta}` : a.delta}</td>
                  <td>{a.onHandAfter}</td>
                  <td className="text-sm text-slate">{a.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Dialog>
  );
}
