"use client";

import { Fragment, useState } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, EmptyState, Forbidden, LoadState, PageHeader, Stat, StatusBadge } from "@/components/ui/bits";
import { formatDate, formatInt, formatSar } from "@/lib/format";
import { SETTLEMENT_STATUS_AR } from "@/lib/labels";
import type { Dashboard, PayoutOverview, Settlement } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Res = { settlements: Settlement[]; balance: Dashboard["balance"]; payout: PayoutOverview; eligibleNetHalalas: number; eligibleOrders: number };

const riyadhDay = new Intl.DateTimeFormat("ar-SA-u-nu-latn-ca-gregory", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
/** "2026-11-01" (a Riyadh calendar date) → "الأحد، 1 نوفمبر" */
const formatRiyadhDate = (ymd: string) => riyadhDay.format(new Date(`${ymd}T00:00:00Z`));

export default function SettlementsPage() {
  const m = useMerchant();
  const res = useApi<Res>(m.can("settlements") ? `${m.base}/settlements` : null, { refreshOn: ["order.paid", "merchant_order", "refund"] });
  const [open, setOpen] = useState<string | null>(null);

  if (!m.can("settlements")) return <Forbidden />;
  const d = res.data;

  return (
    <>
      <PageHeader
        title="المستحقات والتسويات"
        description={
          d?.payout.earlyPayout
            ? "المبالغ بعد خصم عمولة قطعة. متجرك مفعّل للصرف المبكر: تصبح الطلبات مؤهلة فور التوصيل مع حجز نسبة صغيرة حتى انتهاء فترة الإرجاع."
            : "المبالغ بعد خصم عمولة قطعة. تصبح الطلبات مؤهلة للتسوية بعد التوصيل وانتهاء فترة الإرجاع."
        }
      />
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {d && (
        <>
          <section className="card mb-3 flex flex-wrap items-center gap-x-6 gap-y-2 p-4" data-testid="payout-overview">
            <div>
              <p className="text-sm text-slate">موعد التسوية القادمة</p>
              <p className="text-xl font-bold text-brand" data-testid="next-payout">
                {formatRiyadhDate(d.payout.nextSettlementDate)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge tone="brand">{d.payout.cadence === "DAILY" ? "تسوية يومية" : "تسوية أسبوعية"}</Badge>
              {d.payout.earlyPayout && <Badge tone="success">صرف مبكر بعد التوصيل</Badge>}
            </div>
            <p className="min-w-[16rem] flex-1 text-sm text-slate">
              تُنشئ قطعة مسودة التسوية تلقائياً في هذا الموعد، ثم تعتمدها المالية ويُحوَّل المبلغ إلى حسابك البنكي (عادةً خلال يوم عمل).
              {d.payout.earlyPayout &&
                ` نحجز ${(d.payout.reserveBps / 100).toFixed(0)}% من كل طلب صُرف مبكراً، ونُفرج عنه تلقائياً بعد انتهاء فترة الإرجاع (${d.payout.returnWindowDays} أيام) مخصوماً منه أي مرتجع.`}
            </p>
          </section>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="مؤهل للتسوية الآن" value={formatSar(d.payout.eligibleNetHalalas)} hint={`${formatInt(d.payout.eligibleOrders)} طلب`} testId="eligible" />
            <Stat label="قيد المراجعة والتحويل" value={formatSar(d.payout.inReviewHalalas)} hint={`${formatInt(d.payout.inReviewSettlements)} تسوية`} />
            <Stat label="مبلغ محجوز مؤقتاً" value={formatSar(d.payout.reserveHeldHalalas)} hint="يُفرج عنه بعد فترة الإرجاع" testId="reserve-held" />
            <Stat label="الرصيد المستحق لك" value={formatSar(d.balance.payableHalalas)} hint="كل الطلبات المدفوعة غير المحوّلة" testId="payable" />
            <Stat label="إجمالي ما تم تحويله" value={formatSar(d.balance.paidOutHalalas)} />
          </div>
          <h2 className="mb-2 mt-6 font-bold">سجل التسويات</h2>
          {d.settlements.length === 0 ? (
            <EmptyState title="لا توجد تسويات بعد" body="تُنشئ قطعة التسويات تلقائياً في موعد كل دورة للطلبات المؤهلة، وتظهر هنا مع تفاصيل كل طلب." />
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الحالة</th>
                    <th>الإجمالي</th>
                    <th>العمولة</th>
                    <th>المسترد / المحجوز</th>
                    <th>الصافي</th>
                    <th>مرجع التحويل</th>
                    <th>
                      <span className="sr-only">تفاصيل</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {d.settlements.map((s) => (
                    <Fragment key={s.id}>
                      <tr>
                        <td className="whitespace-nowrap">
                          {formatDate(s.createdAt)}
                          {s.automatic && <p className="text-xs text-slate">تلقائية</p>}
                        </td>
                        <td>
                          <StatusBadge status={s.status} labels={SETTLEMENT_STATUS_AR} />
                          {s.paidAt && <p className="text-xs text-slate">حُوّلت {formatDate(s.paidAt)}</p>}
                        </td>
                        <td>{formatSar(s.grossHalalas)}</td>
                        <td>- {formatSar(s.commissionHalalas)}</td>
                        <td>
                          - {formatSar(s.refundsHalalas)}
                          {!!s.reserveHeldHalalas && <p className="text-xs text-slate">محجوز - {formatSar(s.reserveHeldHalalas)}</p>}
                          {!!s.reserveReleasedHalalas && <p className="text-xs text-success">إفراج عن محجوز + {formatSar(s.reserveReleasedHalalas)}</p>}
                        </td>
                        <td className="font-bold">{formatSar(s.netHalalas)}</td>
                        <td className="ltr text-start text-sm">{s.payoutReference ?? "—"}</td>
                        <td>
                          <button type="button" className="btn btn-ghost btn-sm" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? null : s.id)}>
                            {open === s.id ? "إخفاء" : `الطلبات (${s.lines.length})`}
                          </button>
                        </td>
                      </tr>
                      {open === s.id && (
                        <tr>
                          <td colSpan={8} className="bg-mist">
                            <table className="table bg-white">
                              <thead>
                                <tr>
                                  <th>الطلب</th>
                                  <th>الإجمالي</th>
                                  <th>العمولة</th>
                                  <th>المسترد / المحجوز</th>
                                  <th>الصافي</th>
                                </tr>
                              </thead>
                              <tbody>
                                {s.lines.map((l) => (
                                  <tr key={l.id}>
                                    <td>
                                      <span className="ltr">{l.merchantOrder.number}</span>
                                      {l.kind === "RESERVE_RELEASE" && <p className="text-xs text-success">إفراج عن المبلغ المحجوز</p>}
                                    </td>
                                    <td>{formatSar(l.grossHalalas)}</td>
                                    <td>- {formatSar(l.commissionHalalas)}</td>
                                    <td>
                                      - {formatSar(l.refundsHalalas)}
                                      {l.kind !== "RESERVE_RELEASE" && !!l.reserveHalalas && <p className="text-xs text-slate">محجوز - {formatSar(l.reserveHalalas)}</p>}
                                    </td>
                                    <td className="font-semibold">{formatSar(l.netHalalas)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  );
}
