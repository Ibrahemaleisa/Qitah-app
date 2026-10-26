"use client";

import Link from "next/link";
import { useState } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, ErrorNote, Forbidden, PageHeader } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api } from "@/lib/api";
import { cityAr } from "@/lib/labels";
import type { Location, Reference } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type ImportResult = {
  dryRun: boolean;
  results: { row: number; sku: string; status: "created" | "updated" | "error"; message?: string }[];
  summary: { created: number; updated: number; errors: number };
};

/** Mirrors the contract in services/api/src/routes/merchant.ts (POST /offers/import). */
const COLUMNS: { name: string; required: boolean; desc: string }[] = [
  { name: "sku", required: true, desc: "رمزك للعرض. إن كان موجوداً يُحدَّث السعر والمخزون" },
  { name: "partNumber", required: true, desc: "رقم القطعة لدى المصنّع" },
  { name: "brand", required: true, desc: "العلامة التجارية (تُطابق مع رقم القطعة)" },
  { name: "condition", required: true, desc: "NEW أو USED أو REFURBISHED" },
  { name: "priceSar", required: true, desc: "السعر بالريال، حتى منزلتين عشريتين (125.50)" },
  { name: "stock", required: true, desc: "الكمية المتوفرة (رقم صحيح)" },
  { name: "locationId", required: false, desc: "معرّف الفرع (افتراضياً أول فرع نشط)" },
  { name: "nameAr, nameEn, categoryId, origin", required: false, desc: "لإنشاء منتج غير موجود في الكتالوج" },
  { name: "weightGrams, lengthCm, widthCm, heightCm", required: false, desc: "أبعاد المنتج الجديد (مطلوبة عند إنشائه)" },
];

const TEMPLATE_HEADER = "sku,partNumber,brand,condition,priceSar,stock,locationId,nameAr,nameEn,categoryId,origin,weightGrams,lengthCm,widthCm,heightCm";

function csvCell(v: string) {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

export default function ImportPage() {
  const m = useMerchant();
  const toast = useToast();
  const locations = useApi<{ locations: Location[] }>(m.can("catalog.edit") ? `${m.base}/locations` : null);
  const ref = useApi<Reference>(m.can("catalog.edit") ? "/v1/catalog/reference" : null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [checked, setChecked] = useState<{ csv: string; result: ImportResult } | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState<"dry" | "import" | null>(null);
  const [error, setError] = useState<unknown>(null);

  if (!m.can("catalog.edit")) return <Forbidden />;

  const active = locations.data?.locations.filter((l) => l.active) ?? [];
  const dryRunValid = checked?.csv === csv;

  function downloadTemplate() {
    const loc = active[0]?.id ?? "";
    const cat = ref.data?.categories[0]?.id ?? "filters";
    const rows = [
      TEMPLATE_HEADER,
      ["MY-SKU-001", "04152-YZZA1", "Toyota Genuine", "NEW", "45.00", "20", loc, "", "", "", "", "", "", "", ""].map(csvCell).join(","),
      ["MY-SKU-002", "ABC-12345", "Bosch", "NEW", "129.50", "8", loc, "فلتر هواء", "Air filter", cat, "AFTERMARKET", "400", "25", "20", "6"].map(csvCell).join(","),
    ];
    // BOM so Excel opens Arabic text as UTF-8.
    const blob = new Blob(["﻿" + rows.join("\n") + "\n"], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "qitah-offers-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function run(dryRun: boolean) {
    setBusy(dryRun ? "dry" : "import");
    setError(null);
    try {
      const r = await api<ImportResult>(`${m.base}/offers/import`, { method: "POST", body: { csv: csv.replace(/^﻿/, ""), dryRun } });
      if (dryRun) {
        setChecked({ csv, result: r });
        setResult(null);
      } else {
        setResult(r);
        setChecked(null);
        toast({ tone: r.summary.errors ? "error" : "success", title: "اكتمل الاستيراد", body: `جديد ${r.summary.created} · محدّث ${r.summary.updated} · أخطاء ${r.summary.errors}` });
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(null);
    }
  }

  const shown = result ?? (dryRunValid ? checked?.result : null);

  return (
    <>
      <nav className="mb-3 text-sm">
        <Link href="/catalog" className="text-brand underline">
          ← العروض والمخزون
        </Link>
      </nav>
      <PageHeader
        title="استيراد العروض من CSV"
        description="حتى 1000 صف في كل مرة. شغّل التحقق أولاً لمعرفة ما سيُنشأ أو يُحدَّث، ثم نفّذ الاستيراد."
        actions={
          <button type="button" className="btn btn-secondary" onClick={downloadTemplate} data-testid="download-template">
            تنزيل القالب
          </button>
        }
      />

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card space-y-3 p-5 lg:col-span-2">
          <div className="flex flex-wrap items-center gap-3">
            <label className="btn btn-secondary btn-sm cursor-pointer">
              اختيار ملف CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 1_000_000) {
                    toast({ tone: "error", title: "الملف أكبر من 1 ميجابايت" });
                    return;
                  }
                  setCsv(await file.text());
                  setFileName(file.name);
                  setResult(null);
                }}
                data-testid="csv-file"
              />
            </label>
            <span className="text-sm text-slate">{fileName ?? "أو الصق المحتوى أدناه"}</span>
          </div>
          <label htmlFor="csv" className="sr-only">
            محتوى CSV
          </label>
          <textarea
            id="csv"
            className="textarea ltr min-h-[240px] font-mono text-[13px]"
            spellCheck={false}
            placeholder={TEMPLATE_HEADER}
            value={csv}
            onChange={(e) => {
              setCsv(e.target.value);
              setResult(null);
            }}
            data-testid="csv-text"
          />
          <ErrorNote error={error} />
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-secondary" disabled={!csv.trim() || !!busy} onClick={() => run(true)} data-testid="dry-run">
              {busy === "dry" ? "جارٍ التحقق…" : "1. تحقق (تشغيل تجريبي)"}
            </button>
            <button type="button" className="btn btn-primary" disabled={!dryRunValid || !!busy || (checked?.result.summary.created ?? 0) + (checked?.result.summary.updated ?? 0) === 0} onClick={() => run(false)} data-testid="run-import">
              {busy === "import" ? "جارٍ الاستيراد…" : "2. استيراد"}
            </button>
          </div>
          {!dryRunValid && csv.trim() && !result && <p className="hint">شغّل التحقق على المحتوى الحالي قبل الاستيراد.</p>}
          {dryRunValid && checked && checked.result.summary.errors > 0 && <p className="hint text-warning-text">سيتم تخطي الصفوف التي فيها أخطاء واستيراد الباقي.</p>}
        </section>

        <aside className="card p-5 text-sm">
          <h2 className="mb-2 font-bold">الأعمدة</h2>
          <ul className="space-y-2">
            {COLUMNS.map((c) => (
              <li key={c.name}>
                <code className="ltr rounded bg-mist px-1.5 py-0.5 text-[12.5px]">{c.name}</code> {c.required && <Badge tone="brand">مطلوب</Badge>}
                <p className="text-slate">{c.desc}</p>
              </li>
            ))}
          </ul>
          {active.length > 0 && (
            <>
              <h3 className="mb-1 mt-4 font-semibold">معرّفات فروعك</h3>
              <ul className="space-y-1">
                {active.map((l) => (
                  <li key={l.id}>
                    {l.name} ({cityAr(l.city)}): <code className="ltr text-[12px]">{l.id}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
          {ref.data && (
            <>
              <h3 className="mb-1 mt-4 font-semibold">معرّفات الفئات</h3>
              <p className="text-slate">
                {ref.data.categories.map((c) => (
                  <span key={c.id} className="me-2 inline-block">
                    {c.name.ar}: <code className="ltr text-[12px]">{c.id}</code>
                  </span>
                ))}
              </p>
            </>
          )}
        </aside>
      </div>

      {shown && (
        <section className="card mt-5 overflow-x-auto" data-testid="import-results">
          <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
            <h2 className="font-bold">{shown.dryRun ? "نتيجة التحقق (لم يُحفظ شيء)" : "نتيجة الاستيراد"}</h2>
            <Badge tone="success">جديد {shown.summary.created}</Badge>
            <Badge tone="brand">تحديث {shown.summary.updated}</Badge>
            <Badge tone={shown.summary.errors ? "danger" : "neutral"}>أخطاء {shown.summary.errors}</Badge>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>الصف</th>
                <th>SKU</th>
                <th>النتيجة</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {shown.results.map((r) => (
                <tr key={r.row}>
                  <td>{r.row}</td>
                  <td className="ltr text-start">{r.sku}</td>
                  <td>
                    <Badge tone={r.status === "error" ? "danger" : r.status === "created" ? "success" : "brand"}>{r.status === "error" ? "خطأ" : r.status === "created" ? (shown.dryRun ? "سيُنشأ" : "أُنشئ") : shown.dryRun ? "سيُحدَّث" : "حُدِّث"}</Badge>
                  </td>
                  <td className="ltr text-start text-sm text-slate" lang="en">
                    {r.message ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  );
}
