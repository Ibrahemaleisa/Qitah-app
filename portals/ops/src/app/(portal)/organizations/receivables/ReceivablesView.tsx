'use client';

import Link from 'next/link';

import { OrgNav } from '@/components/OrgNav';
import { Async, Card, DateTime, Empty, Money, PageHead } from '@/components/ui';
import { useApi } from '@/lib/hooks';

type Overdue = {
  totalHalalas: number;
  byOrg: { orgId: string; displayName: string; outstandingHalalas: number; orders: number }[];
  items: { orderId: string; number: string; org: { id: string; displayName: string; contactPhone: string } | null; workOrderRef: string | null; totalHalalas: number; outstandingHalalas: number; creditDueAt: string; daysOverdue: number }[];
};

/** NET_TERMS balances past their due date (from the CUSTOMER_RECEIVABLE ledger). Merchants are paid regardless. */
export function ReceivablesView() {
  const state = useApi<Overdue>('v1/ops/receivables/overdue', { live: (e) => e.entityType === 'organization' || e.type.startsWith('order.') });
  return (
    <>
      <PageHead title="مستحقات متأخرة" sub="طلبات الدفع الآجل التي تجاوزت تاريخ الاستحقاق ولم تُسدَّد بالكامل" />
      <OrgNav />
      <Async state={state}>
        {(d) => (
          <div className="stack">
            <Card title={<span className="row gap-sm">الإجمالي المتأخر <Money h={d.totalHalalas} className={d.totalHalalas ? 'neg' : ''} /></span>} flush>
              {d.byOrg.length ? (
                <table className="t">
                  <thead>
                    <tr>
                      <th>الورشة</th>
                      <th className="end">طلبات متأخرة</th>
                      <th className="end">المبلغ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.byOrg.map((o) => (
                      <tr key={o.orgId}>
                        <td>
                          <Link href={`/organizations/${o.orgId}`}>{o.displayName}</Link>
                        </td>
                        <td className="end num">{o.orders}</td>
                        <td className="end">
                          <Money h={o.outstandingHalalas} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : (
                <Empty>لا توجد مستحقات متأخرة</Empty>
              )}
            </Card>
            {d.items.length ? (
              <Card title="الطلبات" flush>
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>الطلب</th>
                        <th>الورشة</th>
                        <th>أمر العمل</th>
                        <th>تاريخ الاستحقاق</th>
                        <th className="end">أيام التأخير</th>
                        <th className="end">المتبقي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((i) => (
                        <tr key={i.orderId}>
                          <td>
                            <Link href={`/orders/${i.orderId}`} className="num">
                              {i.number}
                            </Link>
                          </td>
                          <td>{i.org ? <Link href={`/organizations/${i.org.id}`}>{i.org.displayName}</Link> : '—'}</td>
                          <td>{i.workOrderRef ?? '—'}</td>
                          <td>
                            <DateTime iso={i.creditDueAt} />
                          </td>
                          <td className="end num">{i.daysOverdue}</td>
                          <td className="end">
                            <Money h={i.outstandingHalalas} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
          </div>
        )}
      </Async>
    </>
  );
}
