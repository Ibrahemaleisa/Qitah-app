"use client";

import { useState, type FormEvent } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { ErrorNote, Field, LoadState } from "@/components/ui/bits";
import { api, ApiError } from "@/lib/api";
import { parseWhole, range } from "@/lib/format";
import type { CatalogProduct, Reference } from "@/lib/types";
import { useApi } from "@/lib/useApi";

import type { PickedProduct } from "./OfferForm";

type FitmentRow = { key: number; makeId: string; modelId: string; yearFrom: string; yearTo: string; engines: string[] };

const splitList = (s: string) =>
  s
    .split(/[\n,،]+/)
    .map((x) => x.trim())
    .filter(Boolean);

export function ProductForm({ initialPartNumber, onCreated, onCancel }: { initialPartNumber: string; onCreated: (p: PickedProduct) => void; onCancel: () => void }) {
  const m = useMerchant();
  const ref = useApi<Reference>("/v1/catalog/reference");
  const [f, setF] = useState({
    nameAr: "",
    nameEn: "",
    descriptionAr: "",
    categoryId: "",
    brand: "",
    origin: "AFTERMARKET",
    partNumber: initialPartNumber,
    oemRefs: "",
    weightGrams: "",
    lengthCm: "",
    widthCm: "",
    heightCm: "",
    handling: "STANDARD",
  });
  const [rows, setRows] = useState<FitmentRow[]>([]);
  const [seq, setSeq] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [existing, setExisting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const makes = ref.data?.makes ?? [];
  const modelOf = (r: FitmentRow) => makes.find((mk) => mk.id === r.makeId)?.models.find((md) => md.id === r.modelId);
  const updateRow = (key: number, patch: Partial<FitmentRow>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.nameAr.trim().length < 2) errs.nameAr = "أدخل اسم القطعة بالعربية";
    if (f.nameEn.trim().length < 2) errs.nameEn = "أدخل اسم القطعة بالإنجليزية";
    if (!f.categoryId) errs.categoryId = "اختر الفئة";
    if (!f.brand.trim()) errs.brand = "أدخل العلامة التجارية";
    if (f.partNumber.trim().length < 2) errs.partNumber = "أدخل رقم القطعة";
    const nums = { weightGrams: [500_000, "الوزن بالجرام"], lengthCm: [500, "الطول"], widthCm: [500, "العرض"], heightCm: [500, "الارتفاع"] } as const;
    const parsed: Record<string, number> = {};
    for (const [k, [max]] of Object.entries(nums)) {
      const v = parseWhole(f[k as keyof typeof f]);
      if (!v || v > max) errs[k] = `رقم صحيح من 1 إلى ${max.toLocaleString("en-US")}`;
      else parsed[k] = v;
    }
    const fitment = [];
    for (const r of rows) {
      const model = modelOf(r);
      const from = parseWhole(r.yearFrom);
      const to = parseWhole(r.yearTo);
      if (!model) {
        errs[`fit-${r.key}`] = "اختر الشركة والموديل";
        continue;
      }
      if (!from || !to || from > to || from < model.yearFrom || to > model.yearTo) {
        errs[`fit-${r.key}`] = `السنوات بين ${model.yearFrom} و ${model.yearTo}`;
        continue;
      }
      fitment.push({ modelId: model.id, yearFrom: from, yearTo: to, engines: r.engines });
    }
    setErrors(errs);
    if (Object.keys(errs).length) {
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    setBusy(true);
    setServerError(null);
    setExisting(null);
    try {
      const created = await api<CatalogProduct>(`${m.base}/catalog/products`, {
        method: "POST",
        body: {
          nameAr: f.nameAr.trim(),
          nameEn: f.nameEn.trim(),
          descriptionAr: f.descriptionAr.trim(),
          categoryId: f.categoryId,
          brand: f.brand.trim(),
          origin: f.origin,
          partNumber: f.partNumber.trim(),
          oemReferences: splitList(f.oemRefs),
          weightGrams: parsed.weightGrams,
          lengthCm: parsed.lengthCm,
          widthCm: parsed.widthCm,
          heightCm: parsed.heightCm,
          handling: f.handling,
          fitment,
        },
      });
      onCreated({ id: created.id, nameAr: created.nameAr, brand: created.brand, partNumber: created.partNumber });
    } catch (err) {
      setServerError(err);
      if (err instanceof ApiError && err.code === "PRODUCT_EXISTS") {
        const id = (err.details as { productId?: string } | undefined)?.productId;
        if (id) setExisting(id);
      }
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-5" data-testid="product-form">
      <LoadState loading={ref.loading} error={ref.error} />
      <section className="card space-y-4 p-5">
        <h2 className="font-bold">بيانات القطعة</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="الاسم (عربي)" required error={errors.nameAr}>
            {(p) => <input {...p} name="nameAr" className="input" value={f.nameAr} onChange={set("nameAr")} />}
          </Field>
          <Field label="الاسم (إنجليزي)" required error={errors.nameEn}>
            {(p) => <input {...p} name="nameEn" className="input ltr text-start" value={f.nameEn} onChange={set("nameEn")} />}
          </Field>
          <Field label="الفئة" required error={errors.categoryId}>
            {(p) => (
              <select {...p} name="categoryId" className="select" value={f.categoryId} onChange={set("categoryId")}>
                <option value="">اختر…</option>
                {ref.data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.ar}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="العلامة التجارية" required hint="مثال: Toyota Genuine، Bosch، Denso" error={errors.brand}>
            {(p) => <input {...p} name="brand" className="input ltr text-start" value={f.brand} onChange={set("brand")} />}
          </Field>
          <fieldset>
            <legend className="label">المصدر</legend>
            <div className="flex gap-4 pt-1.5 text-sm">
              {[
                ["OEM", "أصلي (OEM)"],
                ["AFTERMARKET", "تجاري (Aftermarket)"],
              ].map(([v, l]) => (
                <label key={v} className="flex items-center gap-1.5">
                  <input type="radio" name="origin" value={v} checked={f.origin === v} onChange={set("origin")} />
                  {l}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="رقم القطعة لدى المصنّع" required error={errors.partNumber}>
            {(p) => <input {...p} name="partNumber" className="input ltr text-start" value={f.partNumber} onChange={set("partNumber")} />}
          </Field>
          <Field label="أرقام OEM مرجعية (اختياري)" hint="افصل بينها بفاصلة أو سطر جديد" className="sm:col-span-2">
            {(p) => <input {...p} name="oemRefs" className="input ltr text-start" value={f.oemRefs} onChange={set("oemRefs")} />}
          </Field>
          <Field label="الوصف (اختياري)" className="sm:col-span-2">
            {(p) => <textarea {...p} name="descriptionAr" className="textarea" maxLength={2000} value={f.descriptionAr} onChange={set("descriptionAr")} />}
          </Field>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <h2 className="font-bold">الشحن</h2>
        <p className="text-sm text-slate">تُستخدم لحساب تكلفة الشحن وتجميع الطرود. أدخل مقاس القطعة مغلّفة.</p>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
          <Field label="الوزن (جرام)" required error={errors.weightGrams}>
            {(p) => <input {...p} name="weightGrams" className="input" inputMode="numeric" value={f.weightGrams} onChange={set("weightGrams")} />}
          </Field>
          <Field label="الطول (سم)" required error={errors.lengthCm}>
            {(p) => <input {...p} name="lengthCm" className="input" inputMode="numeric" value={f.lengthCm} onChange={set("lengthCm")} />}
          </Field>
          <Field label="العرض (سم)" required error={errors.widthCm}>
            {(p) => <input {...p} name="widthCm" className="input" inputMode="numeric" value={f.widthCm} onChange={set("widthCm")} />}
          </Field>
          <Field label="الارتفاع (سم)" required error={errors.heightCm}>
            {(p) => <input {...p} name="heightCm" className="input" inputMode="numeric" value={f.heightCm} onChange={set("heightCm")} />}
          </Field>
          <Field label="المناولة">
            {(p) => (
              <select {...p} name="handling" className="select" value={f.handling} onChange={set("handling")}>
                <option value="STANDARD">عادي</option>
                <option value="FRAGILE">قابل للكسر</option>
                <option value="OVERSIZED">كبير الحجم</option>
                <option value="HAZMAT">مواد خطرة</option>
              </select>
            )}
          </Field>
        </div>
      </section>

      <section className="card space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-bold">السيارات المتوافقة</h2>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => {
              setRows([...rows, { key: seq, makeId: "", modelId: "", yearFrom: "", yearTo: "", engines: [] }]);
              setSeq(seq + 1);
            }}
            data-testid="add-fitment"
          >
            + إضافة سيارة
          </button>
        </div>
        <p className="rounded-lg border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-warning-text" role="note">
          التوافق الذي تُدخله يظهر للعملاء بوسم <strong>«حسب البائع — غير موثّق»</strong> حتى يتحقق منه فريق قطعة. أدخل فقط السيارات التي تتأكد من توافقها.
        </p>
        {rows.length === 0 && <p className="text-sm text-slate">لا توجد سيارات. يمكنك المتابعة بدونها إن كانت القطعة عامة.</p>}
        {rows.map((r, idx) => {
          const make = makes.find((mk) => mk.id === r.makeId);
          const model = modelOf(r);
          const err = errors[`fit-${r.key}`];
          return (
            <fieldset key={r.key} className="rounded-lg border border-line p-3" data-testid="fitment-row" aria-invalid={err ? true : undefined}>
              <legend className="px-1 text-sm font-semibold">سيارة {idx + 1}</legend>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label="الشركة">
                  {(p) => (
                    <select {...p} className="select" value={r.makeId} onChange={(e) => updateRow(r.key, { makeId: e.target.value, modelId: "", yearFrom: "", yearTo: "", engines: [] })} data-testid="fit-make">
                      <option value="">اختر…</option>
                      {makes.map((mk) => (
                        <option key={mk.id} value={mk.id}>
                          {mk.name.ar}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="الموديل">
                  {(p) => (
                    <select
                      {...p}
                      className="select"
                      value={r.modelId}
                      disabled={!make}
                      onChange={(e) => {
                        const md = make?.models.find((x) => x.id === e.target.value);
                        updateRow(r.key, { modelId: e.target.value, yearFrom: md ? String(md.yearFrom) : "", yearTo: md ? String(md.yearTo) : "", engines: [] });
                      }}
                      data-testid="fit-model"
                    >
                      <option value="">اختر…</option>
                      {make?.models.map((md) => (
                        <option key={md.id} value={md.id}>
                          {`${md.name.ar} (${range(md.yearFrom, md.yearTo)})`}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field label="من سنة">
                  {(p) => <input {...p} className="input" inputMode="numeric" disabled={!model} value={r.yearFrom} onChange={(e) => updateRow(r.key, { yearFrom: e.target.value })} />}
                </Field>
                <Field label="إلى سنة">
                  {(p) => <input {...p} className="input" inputMode="numeric" disabled={!model} value={r.yearTo} onChange={(e) => updateRow(r.key, { yearTo: e.target.value })} />}
                </Field>
              </div>
              {model && model.engines.length > 0 && (
                <div className="mt-3">
                  <p className="label">المحركات (اترك الكل غير محدد إن كانت تناسب جميع المحركات)</p>
                  <div className="flex flex-wrap gap-3 text-sm">
                    {model.engines.map((en) => (
                      <label key={en} className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked={r.engines.includes(en)}
                          onChange={(e) => updateRow(r.key, { engines: e.target.checked ? [...r.engines, en] : r.engines.filter((x) => x !== en) })}
                        />
                        <span className="ltr">{en}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="mt-2 flex items-center justify-between">
                {err ? <p className="field-error">{err}</p> : <span />}
                <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
                  حذف
                </button>
              </div>
            </fieldset>
          );
        })}
      </section>

      <ErrorNote error={serverError} />
      {existing && (
        <div className="rounded-lg bg-brand-50 px-4 py-3 text-sm text-brand">
          هذه القطعة موجودة في الكتالوج.{" "}
          <button type="button" className="font-semibold underline" onClick={() => onCreated({ id: existing, nameAr: f.nameAr || f.partNumber, brand: f.brand, partNumber: f.partNumber })}>
            أضف عرضك على المنتج الموجود
          </button>
        </div>
      )}
      <div className="flex justify-end gap-2">
        <button type="button" className="btn btn-secondary" onClick={onCancel}>
          رجوع للبحث
        </button>
        <button type="submit" className="btn btn-primary" disabled={busy || !ref.data} data-testid="submit-product">
          {busy ? "جارٍ الحفظ…" : "حفظ المنتج والمتابعة للعرض"}
        </button>
      </div>
    </form>
  );
}
