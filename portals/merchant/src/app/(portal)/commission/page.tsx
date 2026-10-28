"use client";

import { useMerchant } from "@/components/portal/MerchantContext";
import { LoadState, PageHeader } from "@/components/ui/bits";
import { formatDate } from "@/lib/format";
import { COMMISSION_SOURCE_AR } from "@/lib/labels";
import type { CommissionRates, RateCell } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const COLUMNS = [
  { origin: "OEM", condition: "NEW", title: "أصلي جديد" },
  { origin: "OEM", condition: "USED", title: "أصلي مستعمل" },
  { origin: "AFTERMARKET", condition: "NEW", title: "تجاري جديد" },
  { origin: "AFTERMARKET", condition: "USED", title: "تجاري مستعمل" },
  { origin: "AFTERMARKET", condition: "REFURBISHED", title: "تجاري مُجدَّد" },
] as const;

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;

function Cell({ c }: { c: RateCell | undefined }) {
  if (!c) return <td>—</td>;
  return (
    <td title={c.ruleName ?? COMMISSION_SOURCE_AR[c.source]}>
      <span className="font-semibold">{pct(c.bps)}</span>
      {c.validTo && <p className="text-xs text-warning-text">حتى {formatDate(c.validTo)}</p>}
    </td>
  );
}

export default function CommissionPage() {
  const m = useMerchant();
  const res = useApi<CommissionRates>(`${m.base}/commission-rates`, { refreshOn: ["merchant.updated"] });
  const d = res.data;
  const b2b = d?.categories[0]?.rates[0]?.b2b;

  return (
    <>
      <PageHeader
        title="نسب العمولة"
        description="عمولة قطعة تُحسب لكل قطعة في الطلب حسب فئتها ونوعها (أصلي أو تجاري) وحالتها. القطع الأصلية هامشها أقل فعمولتها أقل. تُخصم العمولة من قيمة القطع فقط، ولا تُخصم رسوم الدفع الإلكتروني منك."
      />
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {d && (
        <div className="space-y-4">
          {d.merchantCommissionBps !== null && (
            <p className="rounded-lg border border-brand-50 bg-brand-50 px-4 py-3 text-sm text-brand">
              لمتجرك نسبة متفق عليها {pct(d.merchantCommissionBps)} على طلبات الأفراد، إلا إذا ظهرت نسبة خاصة بفئة معينة أدناه.
            </p>
          )}
          <div className="card overflow-x-auto">
            <table className="table" data-testid="commission-table">
              <caption className="sr-only">نسب العمولة لطلبات الأفراد حسب الفئة ونوع القطعة</caption>
              <thead>
                <tr>
                  <th>الفئة</th>
                  {COLUMNS.map((c) => (
                    <th key={`${c.origin}-${c.condition}`}>{c.title}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.categories.map((cat) => (
                  <tr key={cat.categoryId}>
                    <td className="font-medium">{cat.nameAr}</td>
                    {COLUMNS.map((c) => (
                      <Cell key={`${c.origin}-${c.condition}`} c={cat.rates.find((r) => r.origin === c.origin && r.condition === c.condition)?.b2c} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <section className="card p-4 text-sm">
            <h2 className="mb-1 font-bold">طلبات الورش والمنشآت (B2B)</h2>
            <p className="text-slate">
              {b2b ? `عمولة ${pct(b2b.bps)} على طلبات الورش، لأن سلتها أكبر وتكرارها أعلى.` : "—"} تُطبَّق عند تفعيل حسابات الورش في قطعة.
            </p>
          </section>
          <p className="text-xs text-slate">
            مثال: طلب فيه فحمات أصلية بـ 400 ر.س وزيت تجاري بـ 150 ر.س يُحتسب لكل قطعة بنسبتها. النسبة الظاهرة في تفاصيل الطلب هي متوسط القطع. إذا أُرجعت قطعة تُعاد عمولتها بنفس نسبتها.
          </p>
        </div>
      )}
    </>
  );
}
