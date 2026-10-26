"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { ErrorNote, Field, LoadState } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { formatSar, parseSarToHalalas, parseWhole } from "@/lib/format";
import { cityAr } from "@/lib/labels";
import type { Location } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export type PickedProduct = { id: string; nameAr: string; brand: string; partNumber: string };

export function OfferForm({ product, onBack }: { product: PickedProduct; onBack: () => void }) {
  const m = useMerchant();
  const router = useRouter();
  const toast = useToast();
  const locations = useApi<{ locations: Location[] }>(`${m.base}/locations`);
  const active = locations.data?.locations.filter((l) => l.active) ?? [];
  const [f, setF] = useState({ locationId: "", sku: "", condition: "NEW", price: "", compareAt: "", warranty: "0", dMin: "0", dMax: "1", stock: "", noteAr: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const locationId = f.locationId || active[0]?.id || "";
  const priceH = parseSarToHalalas(f.price);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (!locationId) errs.locationId = "أضف فرعاً نشطاً أولاً";
    if (!f.sku.trim()) errs.sku = "أدخل رمز SKU الخاص بك";
    if (!priceH) errs.price = "سعر غير صحيح (مثال 125.50)";
    const compareH = f.compareAt.trim() ? parseSarToHalalas(f.compareAt) : null;
    if (f.compareAt.trim() && !compareH) errs.compareAt = "سعر غير صحيح";
    else if (compareH && priceH && compareH <= priceH) errs.compareAt = "يجب أن يكون أعلى من السعر";
    const w = parseWhole(f.warranty);
    if (w === null || w > 120) errs.warranty = "من 0 إلى 120";
    const a = parseWhole(f.dMin);
    const b = parseWhole(f.dMax);
    if (a === null || a > 30) errs.dMin = "من 0 إلى 30";
    if (b === null || b > 30) errs.dMax = "من 0 إلى 30";
    if (a !== null && b !== null && b < a) errs.dMax = "أكبر من أو يساوي الحد الأدنى";
    const stock = parseWhole(f.stock);
    if (stock === null || stock > 100_000) errs.stock = "أدخل الكمية المتوفرة (0 أو أكثر)";
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    setBusy(true);
    setServerError(null);
    try {
      await api(`${m.base}/offers`, {
        method: "POST",
        body: {
          productId: product.id,
          locationId,
          sku: f.sku.trim(),
          condition: f.condition,
          priceHalalas: priceH,
          compareAtHalalas: compareH,
          warrantyMonths: w,
          dispatchDaysMin: a,
          dispatchDaysMax: b,
          stock,
          ...(f.noteAr.trim() ? { noteAr: f.noteAr.trim() } : {}),
        },
      });
      toast({ tone: "success", title: "تم نشر العرض", body: `${product.nameAr} — ${f.sku.trim()}` });
      router.push(`/catalog`);
    } catch (err) {
      setServerError(err);
      if (err instanceof ApiError && err.code === "ALREADY_EXISTS") setErrors({ sku: "رمز SKU مستخدم في عرض آخر لديك" });
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="card space-y-5 p-5" data-testid="offer-form">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-mist px-4 py-3">
        <div>
          <p className="text-xs text-slate">القطعة</p>
          <p className="font-semibold">{product.nameAr}</p>
          <p className="ltr text-start text-sm text-slate">
            {product.brand} · {product.partNumber}
          </p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onBack}>
          تغيير القطعة
        </button>
      </div>

      <LoadState loading={locations.loading} error={locations.error} />
      {locations.data && active.length === 0 && (
        <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">
          لا يوجد فرع نشط.{" "}
          <Link href="/locations" className="font-semibold underline">
            أضف فرعاً
          </Link>{" "}
          ثم عد إلى هنا.
        </p>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
        <Field label="رمز SKU" required hint="رمزك الداخلي، فريد لكل عرض" error={errors.sku}>
          {(p) => <input {...p} name="sku" className="input ltr text-start" maxLength={60} value={f.sku} onChange={set("sku")} />}
        </Field>
        <Field label="حالة القطعة" required>
          {(p) => (
            <select {...p} name="condition" className="select" value={f.condition} onChange={set("condition")}>
              <option value="NEW">جديدة</option>
              <option value="USED">مستعملة</option>
              <option value="REFURBISHED">مجددة</option>
            </select>
          )}
        </Field>
        <Field label="السعر (ر.س، شامل الضريبة)" required hint={priceH ? `سيظهر للعميل: ${formatSar(priceH)}` : "مثال: 125.50"} error={errors.price}>
          {(p) => <input {...p} name="price" className="input ltr text-start" inputMode="decimal" value={f.price} onChange={set("price")} />}
        </Field>
        <Field label="السعر قبل الخصم (اختياري)" error={errors.compareAt}>
          {(p) => <input {...p} name="compareAt" className="input ltr text-start" inputMode="decimal" value={f.compareAt} onChange={set("compareAt")} />}
        </Field>
        <Field label="الكمية المتوفرة" required error={errors.stock}>
          {(p) => <input {...p} name="stock" className="input" inputMode="numeric" value={f.stock} onChange={set("stock")} />}
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
        <Field label="ملاحظة للعميل (اختياري)" className="sm:col-span-2 lg:col-span-1">
          {(p) => <input {...p} name="noteAr" className="input" maxLength={300} value={f.noteAr} onChange={set("noteAr")} />}
        </Field>
      </div>

      <ErrorNote error={serverError} />
      <div className="flex justify-end gap-2 border-t border-line pt-4">
        <Link href="/catalog" className="btn btn-secondary">
          إلغاء
        </Link>
        <button type="submit" className="btn btn-primary" disabled={busy || active.length === 0} data-testid="submit-offer">
          {busy ? "جارٍ النشر…" : "نشر العرض"}
        </button>
      </div>
    </form>
  );
}
