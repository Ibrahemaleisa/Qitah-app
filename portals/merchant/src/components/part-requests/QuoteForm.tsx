"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { ErrorNote, Field, LoadState } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { formatSar, halalasToInput, parseSarToHalalas, parseWhole } from "@/lib/format";
import { cityAr, ORIGIN_AR } from "@/lib/labels";
import { VALIDITY_HOURS, type RequestDetail } from "@/lib/partRequests";
import type { CatalogProduct, Location, Paged, Reference } from "@/lib/types";
import { markLocalAction, useApi } from "@/lib/useApi";

const MAX_BYTES = 10 * 1024 * 1024;
const IMAGE_TYPES = ["image/jpeg", "image/png"];

type Mode = "catalog" | "free";

/**
 * Create or edit this store's single quote on a part request. Price is typed in SAR and converted to
 * halalas with string math (parseSarToHalalas). The optional photo of the actual part is uploaded to
 * private storage through a short-lived signed URL (purpose "part-quote").
 */
export function QuoteForm({ request, onSaved, onCancel }: { request: RequestDetail; onSaved: () => void; onCancel?: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const existing = request.myQuote;
  const locations = useApi<{ locations: Location[] }>(`${m.base}/locations`);
  const reference = useApi<Reference>("/v1/catalog/reference");
  const active = locations.data?.locations.filter((l) => l.active) ?? [];
  const [mode, setMode] = useState<Mode>(existing?.productId ? "catalog" : "free");
  const [product, setProduct] = useState<{ id: string; nameAr: string; brand: string; partNumber: string } | null>(
    existing?.product ? { id: existing.product.id, nameAr: existing.product.nameAr, brand: existing.product.brand, partNumber: existing.product.partNumber } : null,
  );
  const [f, setF] = useState({
    partName: existing?.partName ?? "",
    brand: existing?.brand ?? "",
    partNumber: existing?.partNumber ?? request.partNumber ?? "",
    categoryId: existing?.categoryId ?? "",
    origin: existing?.origin ?? (request.preferredOrigin === "oem" ? "OEM" : "AFTERMARKET"),
    condition: existing?.condition ?? (request.preferredCondition === "used" ? "USED" : "NEW"),
    price: existing ? halalasToInput(existing.priceHalalas) : "",
    quantity: String(existing?.quantity ?? request.quantity),
    warranty: String(existing?.warrantyMonths ?? 0),
    dMin: String(existing?.dispatchDays[0] ?? 0),
    dMax: String(existing?.dispatchDays[1] ?? 1),
    locationId: existing?.locationId ?? "",
    validHours: "24",
    note: existing?.note ?? "",
  });
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const locationId = f.locationId || active[0]?.id || "";
  const priceH = parseSarToHalalas(f.price);

  async function upload(photo: File): Promise<string> {
    const target = await api<{ key: string; uploadUrl: string; method: "PUT"; headers: Record<string, string> }>(`${m.base}/uploads`, {
      method: "POST",
      body: { purpose: "part-quote", contentType: photo.type, sizeBytes: photo.size, fileName: photo.name },
    });
    let res: Response;
    try {
      res = await fetch(target.uploadUrl, { method: target.method, headers: target.headers, body: photo });
    } catch {
      // Local upload target has no CORS for PUT: relay through this portal's server.
      try {
        res = await fetch("/api/upload", { method: "POST", headers: { "content-type": photo.type, "x-upload-url": target.uploadUrl }, body: photo, credentials: "same-origin" });
      } catch {
        throw new ApiError(0, "UPLOAD_FAILED", "Upload failed (network)");
      }
    }
    if (!res.ok) throw new ApiError(res.status, "UPLOAD_FAILED", `Upload failed (${res.status})`);
    return target.key;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (mode === "catalog" && !product) errs.product = "اختر القطعة من الكتالوج أو اكتب اسمها";
    if (mode === "free" && f.partName.trim().length < 2) errs.partName = "اكتب اسم القطعة";
    if (mode === "free" && !f.brand.trim()) errs.brand = "اكتب العلامة التجارية (أو «غير معروف» للمستعمل)";
    if (!priceH) errs.price = "سعر غير صحيح (مثال 125.50)";
    const qty = parseWhole(f.quantity);
    if (!qty || qty > request.quantity) errs.quantity = `من 1 إلى ${request.quantity}`;
    const w = parseWhole(f.warranty);
    if (w === null || w > 120) errs.warranty = "من 0 إلى 120";
    const a = parseWhole(f.dMin);
    const b = parseWhole(f.dMax);
    if (a === null || a > 30) errs.dMin = "من 0 إلى 30";
    if (b === null || b > 30) errs.dMax = "من 0 إلى 30";
    if (a !== null && b !== null && b < a) errs.dMax = "أكبر من أو يساوي الحد الأدنى";
    if (!locationId) errs.locationId = "أضف فرعاً نشطاً أولاً";
    if (file && !IMAGE_TYPES.includes(file.type)) errs.photo = "الصورة يجب أن تكون JPEG أو PNG";
    else if (file && file.size > MAX_BYTES) errs.photo = "الحد الأقصى 10 ميجابايت";
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    setServerError(null);
    try {
      let photoKey: string | undefined;
      if (file) {
        setBusy("جارٍ رفع الصورة…");
        photoKey = await upload(file);
      }
      setBusy(existing ? "جارٍ حفظ التعديل…" : "جارٍ إرسال العرض…");
      const body = {
        ...(mode === "catalog"
          ? { productId: product!.id }
          : {
              ...(existing?.productId ? { productId: null } : {}),
              partName: f.partName.trim(),
              brand: f.brand.trim(),
              ...(f.partNumber.trim().length >= 2 ? { partNumber: f.partNumber.trim() } : {}),
              ...(f.categoryId ? { categoryId: f.categoryId } : {}),
              origin: f.origin,
            }),
        condition: f.condition,
        priceHalalas: priceH,
        quantity: qty,
        warrantyMonths: w,
        dispatchDaysMin: a,
        dispatchDaysMax: b,
        locationId,
        validHours: Number(f.validHours),
        ...(photoKey ? { photoKey } : {}),
        note: f.note.trim() || null,
      };
      markLocalAction(request.id);
      await api(`${m.base}/part-requests/${request.id}/quote`, { method: existing ? "PATCH" : "POST", body });
      toast({ tone: "success", title: existing ? "تم تحديث عرضك" : "تم إرسال عرضك للعميل", body: `${request.number} — ${formatSar(priceH)}` });
      onSaved();
    } catch (err) {
      setServerError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card space-y-5 p-5" data-testid="quote-form">
      <h2 className="text-lg font-bold text-brand">{existing ? "تعديل عرضك" : "قدّم عرضك"}</h2>
      <p className="text-sm text-slate">العميل يرى سعرك وحالة القطعة والضمان ومدة التجهيز. لا يرى التجار الآخرون عرضك.</p>

      <fieldset>
        <legend className="label">القطعة</legend>
        <div className="flex flex-wrap gap-2">
          {(["free", "catalog"] as const).map((k) => (
            <label key={k} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${mode === k ? "border-brand bg-brand-50 font-semibold text-brand" : "border-line"}`}>
              <input type="radio" name="mode" value={k} checked={mode === k} onChange={() => setMode(k)} />
              {k === "free" ? "أكتب اسم القطعة" : "أختار من كتالوج قطعة"}
            </label>
          ))}
        </div>
      </fieldset>

      {mode === "catalog" ? (
        <CatalogPicker picked={product} onPick={setProduct} error={errors.product} initial={request.partNumber ?? ""} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="اسم القطعة" required error={errors.partName}>
            {(p) => <input {...p} name="partName" className="input" maxLength={160} value={f.partName} onChange={set("partName")} placeholder="مثال: حساس أكسجين خلفي" />}
          </Field>
          <Field label="العلامة التجارية" required error={errors.brand}>
            {(p) => <input {...p} name="brand" className="input" maxLength={80} value={f.brand} onChange={set("brand")} />}
          </Field>
          <Field label="رقم القطعة (اختياري)">
            {(p) => <input {...p} name="partNumber" className="input ltr text-start" maxLength={60} value={f.partNumber} onChange={set("partNumber")} />}
          </Field>
          <Field label="الفئة (اختياري)">
            {(p) => (
              <select {...p} name="categoryId" className="select" value={f.categoryId} onChange={set("categoryId")}>
                <option value="">—</option>
                {reference.data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.ar}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="المنشأ">
            {(p) => (
              <select {...p} name="origin" className="select" value={f.origin} onChange={set("origin")}>
                <option value="OEM">{ORIGIN_AR.OEM}</option>
                <option value="AFTERMARKET">{ORIGIN_AR.AFTERMARKET}</option>
              </select>
            )}
          </Field>
        </div>
      )}

      <LoadState loading={locations.loading} error={locations.error} />
      {locations.data && active.length === 0 && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">
          لا يوجد فرع نشط.{" "}
          <Link href="/locations" className="font-semibold underline">
            أضف فرعاً
          </Link>
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="حالة القطعة" required>
          {(p) => (
            <select {...p} name="condition" className="select" value={f.condition} onChange={set("condition")}>
              <option value="NEW">جديدة</option>
              <option value="USED">مستعملة</option>
              <option value="REFURBISHED">مجددة</option>
            </select>
          )}
        </Field>
        <Field label="السعر للقطعة (ر.س، شامل الضريبة)" required hint={priceH ? `سيظهر للعميل: ${formatSar(priceH)}` : "مثال: 125.50"} error={errors.price}>
          {(p) => <input {...p} name="price" className="input ltr text-start" inputMode="decimal" value={f.price} onChange={set("price")} data-testid="quote-price" />}
        </Field>
        <Field label="الكمية المتوفرة لهذا الطلب" hint={`طلب العميل ${request.quantity}`} error={errors.quantity}>
          {(p) => <input {...p} name="quantity" className="input" inputMode="numeric" value={f.quantity} onChange={set("quantity")} />}
        </Field>
        <Field label="الفرع الذي تُشحن منه" required error={errors.locationId}>
          {(p) => (
            <select {...p} name="locationId" className="select" value={locationId} onChange={set("locationId")}>
              {active.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} — {cityAr(l.city)}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="الضمان (بالأشهر)" error={errors.warranty}>
          {(p) => <input {...p} name="warranty" className="input" inputMode="numeric" value={f.warranty} onChange={set("warranty")} />}
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="التجهيز من (يوم)" error={errors.dMin}>
            {(p) => <input {...p} name="dMin" className="input" inputMode="numeric" value={f.dMin} onChange={set("dMin")} />}
          </Field>
          <Field label="إلى (يوم)" error={errors.dMax}>
            {(p) => <input {...p} name="dMax" className="input" inputMode="numeric" value={f.dMax} onChange={set("dMax")} />}
          </Field>
        </div>
        <Field label="صلاحية العرض" hint={existing ? "الحفظ يجدد الصلاحية من الآن" : undefined}>
          {(p) => (
            <select {...p} name="validHours" className="select" value={f.validHours} onChange={set("validHours")}>
              {VALIDITY_HOURS.map((h) => (
                <option key={h} value={h}>
                  {h} ساعة
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label="صورة القطعة الفعلية (اختياري)" hint={existing?.photoUrl && !file ? "توجد صورة مرفقة؛ اختر صورة جديدة لاستبدالها" : "JPEG أو PNG حتى 10 ميجابايت"} error={errors.photo}>
          {(p) => <input {...p} type="file" accept="image/jpeg,image/png" className="input" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}
        </Field>
        <Field label="ملاحظة للعميل (اختياري)" className="sm:col-span-2 lg:col-span-1">
          {(p) => <input {...p} name="note" className="input" maxLength={500} value={f.note} onChange={set("note")} placeholder="مثال: مفحوصة وتعمل، من سيارة 2020" />}
        </Field>
      </div>

      <ErrorNote error={serverError} />
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {onCancel && (
          <button type="button" className="btn btn-secondary" onClick={onCancel}>
            إلغاء
          </button>
        )}
        <button type="submit" className="btn btn-primary" disabled={!!busy || active.length === 0} data-testid="submit-quote">
          {busy ?? (existing ? "حفظ التعديل" : "إرسال العرض")}
        </button>
      </div>
    </form>
  );
}

function CatalogPicker({ picked, onPick, error, initial }: { picked: { id: string; nameAr: string; brand: string; partNumber: string } | null; onPick: (p: { id: string; nameAr: string; brand: string; partNumber: string } | null) => void; error?: string; initial: string }) {
  const m = useMerchant();
  const [q, setQ] = useState(initial);
  const [term, setTerm] = useState(initial);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const res = useApi<Paged<CatalogProduct>>(!picked && term.length >= 2 ? `${m.base}/catalog/products?limit=10&q=${encodeURIComponent(term)}` : null);

  if (picked) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mist px-4 py-3">
        <div>
          <p className="font-semibold">{picked.nameAr}</p>
          <p className="ltr text-start text-sm text-slate">
            {picked.brand} · {picked.partNumber}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => onPick(null)}>
          تغيير القطعة
        </button>
      </div>
    );
  }
  return (
    <div>
      <label htmlFor="quote-catalog-q" className="label">
        ابحث باسم القطعة أو رقمها
      </label>
      <input id="quote-catalog-q" type="search" className="input" value={q} onChange={(e) => setQ(e.target.value)} aria-invalid={error ? true : undefined} />
      {error && <p className="field-error">{error}</p>}
      <div className="mt-2" aria-live="polite">
        {term.length >= 2 && <LoadState loading={res.loading} error={res.error} />}
        {res.data && res.data.items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {res.data.items.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">{p.nameAr}</p>
                  <p className="ltr text-start text-xs text-slate">
                    {p.brand} · {p.partNumber}
                  </p>
                </div>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => onPick({ id: p.id, nameAr: p.nameAr, brand: p.brand, partNumber: p.partNumber })}>
                  اختيار
                </button>
              </li>
            ))}
          </ul>
        )}
        {res.data && res.data.items.length === 0 && <p className="rounded-lg bg-mist px-3 py-2 text-sm text-slate">لا توجد نتائج. اكتب اسم القطعة بدلاً من ذلك.</p>}
      </div>
    </div>
  );
}
