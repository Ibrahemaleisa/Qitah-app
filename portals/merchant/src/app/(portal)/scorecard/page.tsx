"use client";

import Link from "next/link";
import { useState } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, LoadState, PageHeader } from "@/components/ui/bits";
import { formatDateTime, formatInt, percent } from "@/lib/format";
import { SCORECARD_WARNING_AR } from "@/lib/labels";
import type { Scorecard, WindowMetrics } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type MetricKey = "outOfStockRate" | "freshness" | "acceptanceRate" | "onTimeReadyRate" | "badReturnRate" | "avgAcceptMinutes" | "cancellationRate";

type MetricDef = {
  key: MetricKey;
  title: string;
  what: string;
  target: string;
  tips: string[];
  /** true when the value breaches the warning threshold. */
  bad: (v: number | null, s: Scorecard) => boolean;
  format: (v: number | null) => string;
  detail: (w: WindowMetrics, s: Scorecard) => string;
};

const METRICS: MetricDef[] = [
  {
    key: "outOfStockRate",
    title: "الرفض بسبب نفاد المخزون",
    what: "نسبة الطلبات المدفوعة التي رفضتها لأن القطعة غير متوفرة. هذا أكثر ما يُفقد العميل ثقته: دفع ثم أُلغي طلبه.",
    target: "أقل من 3% (الهدف أقل من 2%)",
    tips: [
      "حدّث الكميات فور البيع من الكاونتر، أو قلّل الكمية المعروضة في قطعة لتترك هامش أمان.",
      "أوقف العرض مؤقتاً بدلاً من رفض الطلب إذا كانت القطعة غير مضمونة.",
      "استخدم «أكّد كل العروض» بعد كل جرد.",
    ],
    bad: (v, s) => v !== null && v > s.thresholds.outOfStockRate,
    format: percent,
    detail: (w) => `${formatInt(w.outOfStockRejected)} من ${formatInt(w.received)} طلب`,
  },
  {
    key: "freshness",
    title: "دقة المخزون (عروض مؤكدة حديثاً)",
    what: "نسبة عروضك النشطة التي أكدت مخزونها أو سعرها خلال المهلة. العروض غير المؤكدة تظهر بعد غيرها، وتُخفى عن العملاء بعد مدة أطول حتى تؤكدها.",
    target: "90% أو أكثر",
    tips: ["أي تحديث للكمية أو السعر يُعدّ تأكيداً تلقائياً.", "استيراد ملف CSV يؤكد كل الصفوف المستوردة.", "قبول الطلب يؤكد العرض نفسه."],
    bad: (v, s) => v !== null && v < s.thresholds.freshnessRate,
    format: percent,
    detail: (_w, s) => `${formatInt(s.offers.fresh)} من ${formatInt(s.offers.active)} عرض · غير مؤكد بعد ${s.offers.staleAfterDays} أيام، ومخفي بعد ${s.offers.hiddenAfterDays} يوماً`,
  },
  {
    key: "acceptanceRate",
    title: "نسبة القبول",
    what: "من الطلبات التي قررت فيها (قبول أو رفض)، كم قبلت.",
    target: "90% أو أكثر",
    tips: ["فعّل الإشعارات واقبل الطلبات أولاً بأول.", "إذا كان السعر خاطئاً فعدّله في العروض قبل أن يصلك طلب."],
    bad: (v, s) => v !== null && v < s.thresholds.acceptanceRate,
    format: percent,
    detail: (w) => `${formatInt(w.accepted)} مقبول · ${formatInt(w.rejected)} مرفوض`,
  },
  {
    key: "onTimeReadyRate",
    title: "التجهيز في الموعد",
    what: "نسبة الطلبات التي أصبحت جاهزة للاستلام قبل انتهاء مهلة التجهيز.",
    target: "90% أو أكثر",
    tips: ["جهّز الطلبات السريعة (نفس اليوم) أولاً.", "إذا كانت مهلة التجهيز قصيرة على فرعك فتواصل مع قطعة لتعديلها."],
    bad: (v, s) => v !== null && v < s.thresholds.onTimeReadyRate,
    format: percent,
    detail: (w) => `${formatInt(w.readyOnTime)} من ${formatInt(w.ready)} طلب جاهز`,
  },
  {
    key: "avgAcceptMinutes",
    title: "متوسط وقت القبول",
    what: "الوقت من دفع العميل حتى قبولك للطلب. طلبات التوصيل في نفس اليوم مهلتها 15 دقيقة فقط.",
    target: "15 دقيقة أو أقل",
    tips: ["اترك بوابة التجار مفتوحة في الفرع خلال ساعات العمل.", "أضف موظفاً بصلاحية «موظف» ليقبل الطلبات."],
    bad: (v) => v !== null && v > 60,
    format: (v) => (v === null ? "—" : `${formatInt(v)} د`),
    detail: (w) => `على ${formatInt(w.accepted)} طلب`,
  },
  {
    key: "badReturnRate",
    title: "مرتجعات: قطعة خطأ أو غير مطابقة",
    what: "مرتجعات سببها وصف العرض أو توافق أضفته أنت، من الطلبات المسلّمة. لا تُحسب مرتجعات «ضمان قطعة» لأن التوافق فيها من كتالوج قطعة.",
    target: "أقل من 5% (الهدف أقل من 3%)",
    tips: ["أضف رقم القطعة الأصلي (OEM) وتأكد من سنوات التوافق.", "صوّر القطعة الفعلية واذكر أي اختلاف في الملاحظات."],
    bad: (v, s) => v !== null && v > s.thresholds.badReturnRate,
    format: percent,
    detail: (w) => `${formatInt(w.badReturns)} مرتجع من ${formatInt(w.delivered)} طلب مسلّم`,
  },
  {
    key: "cancellationRate",
    title: "نسبة الإلغاء من التاجر",
    what: "كل الطلبات المدفوعة التي رفضتها لأي سبب (نفاد، خطأ سعر، عدم القدرة على التجهيز). إلغاءات العملاء لا تُحسب عليك.",
    target: "أقل من 3%",
    tips: ["معظم الإلغاءات سببها المخزون أو السعر: حدّثهما قبل أن يصلك الطلب."],
    bad: (v) => v !== null && v > 0.03,
    format: percent,
    detail: (w) => `${formatInt(w.rejected)} من ${formatInt(w.received)} طلب · إلغاءات العملاء ${formatInt(w.customerCancelled)}`,
  },
];

const COMPONENTS: { key: keyof Scorecard["components"]; title: string }[] = [
  { key: "stock", title: "توفر المخزون (عكس الرفض لنفاد المخزون)" },
  { key: "freshness", title: "دقة المخزون" },
  { key: "acceptance", title: "القبول" },
  { key: "onTime", title: "التجهيز في الموعد" },
  { key: "returns", title: "المرتجعات" },
  { key: "speed", title: "سرعة القبول" },
];

function valueOf(key: MetricKey, w: WindowMetrics, s: Scorecard): number | null {
  if (key === "freshness") return s.offers.freshnessRate;
  return w[key];
}

export default function ScorecardPage() {
  const m = useMerchant();
  const res = useApi<Scorecard>(`${m.base}/scorecard`, { refreshOn: ["merchant_order", "offer", "return"] });
  const [days, setDays] = useState<30 | 90>(30);
  const s = res.data;
  const w = s ? (days === 30 ? s.d30 : s.d90) : null;
  const scoreTone = !s ? "" : s.qualityScore >= 85 ? "text-success" : s.qualityScore >= 70 ? "text-warning-text" : "text-danger";

  return (
    <>
      <PageHeader
        title="أداء المتجر"
        description="مؤشرات تحسبها قطعة من طلباتك وعروضك. تؤثر درجة الجودة في ترتيب عروضك عند تساوي الأسعار، وتساعدك على معرفة ما يجب تحسينه."
      />
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {s && w && (
        <div className="space-y-5">
          <section className="card flex flex-wrap items-center gap-6 p-5" data-testid="quality-score">
            <div className="text-center">
              <p className="text-sm text-slate">درجة الجودة</p>
              <p className={`text-5xl font-bold ${scoreTone}`}>{s.qualityScore}</p>
              <p className="text-xs text-muted">من 100 · آخر 90 يوماً</p>
            </div>
            <div className="min-w-[16rem] flex-1 text-sm">
              {s.warnings.length === 0 ? (
                <p className="font-semibold text-success">ممتاز، لا توجد تنبيهات على متجرك.</p>
              ) : (
                <>
                  <p className="mb-1 font-semibold">تنبيهات آخر 30 يوماً:</p>
                  <ul className="flex flex-wrap gap-1.5" data-testid="scorecard-warnings">
                    {s.warnings.map((x) => (
                      <li key={x}>
                        <Badge tone="danger">{SCORECARD_WARNING_AR[x] ?? x}</Badge>
                      </li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-2 text-xs text-slate">حُسبت {formatDateTime(s.generatedAt)}. المتجر الجديد يبدأ قرب 80 ثم تتحرك الدرجة مع كل طلب.</p>
            </div>
          </section>

          <div className="flex items-center gap-2" role="group" aria-label="الفترة">
            {([30, 90] as const).map((d) => (
              <button key={d} type="button" className={`btn btn-sm ${days === d ? "btn-primary" : "btn-secondary"}`} aria-pressed={days === d} onClick={() => setDays(d)}>
                آخر {d} يوماً
              </button>
            ))}
            <span className="text-sm text-slate">{formatInt(w.received)} طلب مدفوع في الفترة</span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {METRICS.map((def) => {
              const v = valueOf(def.key, w, s);
              const bad = def.bad(v, s);
              return (
                <article key={def.key} className={`card p-4 ${bad ? "border-danger/40" : ""}`} data-testid={`metric-${def.key}`}>
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-bold">{def.title}</h2>
                    <p className={`text-2xl font-bold ${bad ? "text-danger" : "text-ink"}`}>{def.format(v)}</p>
                  </div>
                  <p className="mt-1 text-xs text-slate">{def.detail(w, s)}</p>
                  <p className="mt-2 text-sm">{def.what}</p>
                  <p className="mt-1 text-xs text-slate">المستهدف: {def.target}</p>
                  <details className="mt-2 text-sm" open={bad}>
                    <summary className="cursor-pointer font-semibold text-brand">كيف تتحسن؟</summary>
                    <ul className="mt-1 list-disc space-y-0.5 ps-5 text-slate">
                      {def.tips.map((t) => (
                        <li key={t}>{t}</li>
                      ))}
                    </ul>
                  </details>
                </article>
              );
            })}
          </div>

          <section className="card p-5">
            <h2 className="mb-1 font-bold">كيف تُحسب درجة الجودة؟</h2>
            <p className="mb-3 text-sm text-slate">
              متوسط موزون لستة مكونات على آخر 90 يوماً. كل مكون من 0 إلى 1، ويُقرَّب تدريجياً نحو 0.8 حين يكون عدد الطلبات قليلاً حتى لا يرفع أو يُسقط طلب واحد درجتك.
            </p>
            <table className="table text-sm">
              <thead>
                <tr>
                  <th>المكون</th>
                  <th>الوزن</th>
                  <th>قيمتك</th>
                </tr>
              </thead>
              <tbody>
                {COMPONENTS.map((c) => (
                  <tr key={c.key}>
                    <td>{c.title}</td>
                    <td>{s.weights[c.key]}%</td>
                    <td>{percent(s.components[c.key])}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-slate">
              التوفر = 1 − (نسبة الرفض لنفاد المخزون ÷ 10%) · المرتجعات = 1 − (النسبة ÷ 10%) · السرعة = 1 عند 15 دقيقة أو أقل وتنخفض حتى 0 عند 4 ساعات.{" "}
              <Link href="/catalog" className="font-semibold text-brand underline">
                راجع عروضك
              </Link>
            </p>
          </section>
        </div>
      )}
    </>
  );
}
