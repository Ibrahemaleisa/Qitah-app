"use client";

import { Fragment, useState } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { EmptyState, Forbidden, LoadState, PageHeader, Stat, StatusBadge } from "@/components/ui/bits";
import { formatDate, formatInt, formatSar } from "@/lib/format";
import { SETTLEMENT_STATUS_AR } from "@/lib/labels";
import type { Dashboard, Settlement } from "@/lib/types";
import { useApi } from "@/lib/useApi";

type Res = { settlements: Settlement[]; balance: Dashboard["balance"]; eligibleNetHalalas: number; eligibleOrders: number };

export default function SettlementsPage() {
  const m = useMerchant();
  const res = useApi<Res>(m.can("settlements") ? `${m.base}/settlements` : null, { refreshOn: ["order.paid", "merchant_order", "refund"] });
  const [open, setOpen] = useState<string | null>(null);

  if (!m.can("settlements")) return <Forbidden />;
  const d = res.data;

  return (
    <>
      <PageHeader title="المستحقات والتسويات" description="المبالغ بعد خصم عمولة قطعة. تصبح الطلبات مؤهلة للتسوية بعد التوصيل وانتهاء فترة الإرجاع." />
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="الرصيد المستحق لك" value={formatSar(d.balance.payableHalalas)} testId="payable" />
            <Stat label="مؤهل للتسوية الآن" value={formatSar(d.eligibleNetHalalas)} hint={`${formatInt(d.eligibleOrders)} طلب`} />
            <Stat label="إجمالي ما تم تحويله" value={formatSar(d.balance.paidOutHalalas)} />
            <Stat label="عمولة قطعة (إجمالي)" value={formatSar(d.balance.commissionHalalas)} />
          </div>
          <h2 className="mb-2 mt-6 font-bold">سجل التسويات</h2>
          {d.settlements.length === 0 ? (
            <EmptyState title="لا توجد تسويات بعد" body="تُنشئ قطعة التسويات دورياً للطلبات المؤهلة، وتظهر هنا مع تفاصيل كل طلب." />
          ) : (
            <div className="card overflow-x-auto">
              <table className="table">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الحالة</th>
                    <th>الإجمالي</th>
                    <th>العمولة</th>
                    <th>المسترد</th>
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
                        <td className="whitespace-nowrap">{formatDate(s.createdAt)}</td>
                        <td>
                          <StatusBadge status={s.status} labels={SETTLEMENT_STATUS_AR} />
                          {s.paidAt && <p className="text-xs text-slate">حُوّلت {formatDate(s.paidAt)}</p>}
                        </td>
                        <td>{formatSar(s.grossHalalas)}</td>
                        <td>- {formatSar(s.commissionHalalas)}</td>
                        <td>- {formatSar(s.refundsHalalas)}</td>
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
                                  <th>المسترد</th>
                                  <th>الصافي</th>
                                </tr>
                              </thead>
                              <tbody>
                                {s.lines.map((l) => (
                                  <tr key={l.id}>
                                    <td className="ltr text-start">{l.merchantOrder.number}</td>
                                    <td>{formatSar(l.grossHalalas)}</td>
                                    <td>- {formatSar(l.commissionHalalas)}</td>
                                    <td>- {formatSar(l.refundsHalalas)}</td>
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
