"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { OfferForm, type PickedProduct } from "@/components/catalog/OfferForm";
import { ProductForm } from "@/components/catalog/ProductForm";
import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, Forbidden, LoadState, PageHeader } from "@/components/ui/bits";
import { ORIGIN_AR } from "@/lib/labels";
import type { CatalogProduct, Paged } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function NewOfferPage() {
  const m = useMerchant();
  const [step, setStep] = useState<"search" | "product" | "offer">("search");
  const [picked, setPicked] = useState<PickedProduct | null>(null);
  const [lastQuery, setLastQuery] = useState("");

  if (!m.can("catalog.edit")) return <Forbidden />;

  return (
    <>
      <nav className="mb-3 text-sm">
        <Link href="/catalog" className="text-brand underline">
          ← العروض والمخزون
        </Link>
      </nav>
      <PageHeader title="إضافة عرض" description="ابحث عن القطعة في كتالوج قطعة أولاً. إن وُجدت أضف عرضك عليها مباشرة، وإلا أنشئ منتجاً جديداً." />
      <ol className="mb-5 flex flex-wrap gap-2 text-sm" aria-label="الخطوات">
        {[
          ["search", "1. البحث في الكتالوج"],
          ["product", "2. منتج جديد (عند الحاجة)"],
          ["offer", "3. تفاصيل العرض"],
        ].map(([k, l]) => (
          <li key={k} aria-current={step === k ? "step" : undefined} className={`rounded-full px-3 py-1 ${step === k ? "bg-brand text-white" : "bg-white text-slate ring-1 ring-line"}`}>
            {l}
          </li>
        ))}
      </ol>
      {m.status !== "APPROVED" && (
        <p className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">يمكنك تجهيز المنتجات الآن، لكن نشر العروض متاح بعد اعتماد المتجر.</p>
      )}

      {step === "search" && (
        <ProductSearch
          initial={lastQuery}
          onPick={(p) => {
            setPicked(p);
            setStep("offer");
          }}
          onCreate={(q) => {
            setLastQuery(q);
            setStep("product");
          }}
        />
      )}
      {step === "product" && (
        <ProductForm
          initialPartNumber={/\d/.test(lastQuery) ? lastQuery : ""}
          onCancel={() => setStep("search")}
          onCreated={(p) => {
            setPicked(p);
            setStep("offer");
          }}
        />
      )}
      {step === "offer" && picked && <OfferForm product={picked} onBack={() => setStep("search")} />}
    </>
  );
}

function ProductSearch({ initial, onPick, onCreate }: { initial: string; onPick: (p: PickedProduct) => void; onCreate: (q: string) => void }) {
  const m = useMerchant();
  const [q, setQ] = useState(initial);
  const [term, setTerm] = useState(initial);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);
  const res = useApi<Paged<CatalogProduct>>(term.length >= 2 ? `${m.base}/catalog/products?limit=20&q=${encodeURIComponent(term)}` : null);

  return (
    <section className="card p-5">
      <label htmlFor="catalog-q" className="label">
        اسم القطعة أو رقمها (رقم الشركة المصنعة أو OEM)
      </label>
      <input id="catalog-q" type="search" className="input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="مثال: فلتر زيت كامري أو 04152-YZZA1" data-testid="catalog-search" />
      <p className="hint">البحث يتجاهل المسافات والشرطات في أرقام القطع.</p>

      <div className="mt-4" aria-live="polite">
        {term.length >= 2 && <LoadState loading={res.loading} error={res.error} />}
        {res.data && res.data.items.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {res.data.items.map((p) => {
              const oem = p.identifiers.filter((i) => i.type === "OEM").map((i) => i.value);
              const verified = p.fitments.filter((f) => f.source === "CATALOG").length;
              return (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3" data-testid="catalog-result">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{p.nameAr}</p>
                    <p className="ltr text-start text-sm text-slate">
                      {p.brand} · {p.partNumber}
                      {oem.length ? ` · OEM ${oem.slice(0, 3).join(", ")}` : ""}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge>{ORIGIN_AR[p.origin]}</Badge>
                      {p.category && <Badge>{p.category.nameAr}</Badge>}
                      {p.fitments.length > 0 && <Badge tone={verified ? "success" : "warning"}>{verified ? `توافق موثّق (${verified})` : `توافق حسب البائع (${p.fitments.length})`}</Badge>}
                    </div>
                  </div>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => onPick({ id: p.id, nameAr: p.nameAr, brand: p.brand, partNumber: p.partNumber })}>
                    أضف عرضي على هذه القطعة
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {res.data && res.data.items.length === 0 && <p className="rounded-lg bg-mist px-4 py-3 text-sm text-slate">لا توجد نتائج لـ «{term}» في الكتالوج.</p>}
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <p className="text-sm text-slate">لم تجد القطعة؟</p>
        <button type="button" className="btn btn-secondary" onClick={() => onCreate(term)} data-testid="create-product">
          أنشئ منتجاً جديداً
        </button>
      </div>
    </section>
  );
}
