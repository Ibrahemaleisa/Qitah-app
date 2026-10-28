'use client';

import Link from 'next/link';

import { OrgNav } from '@/components/OrgNav';
import { Async, Card, DateTime, Empty, PageHead, StatusChip } from '@/components/ui';
import { useApi } from '@/lib/hooks';

type Lead = { phone: string; workshopName: string | null; reviews: number; lastSeenAt: string | null; organization: { id: string; displayName: string; status: string } | null };

/** Workshops that mechanics named on "send to my mechanic" reviews: a sales follow-up list for workshop accounts. */
export function LeadsView() {
  const state = useApi<{ items: Lead[] }>('v1/ops/workshop-leads');
  return (
    <>
      <PageHead title="ورش محتملة" sub="ورش ذكرها الميكانيكيون في صفحات «أرسل لميكانيكي» — للتواصل ودعوتها لحساب ورشة" />
      <OrgNav />
      <Card flush>
        <Async state={state}>
          {(d) =>
            d.items.length ? (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>الورشة</th>
                      <th>الجوال</th>
                      <th className="end">مراجعات</th>
                      <th>آخر نشاط</th>
                      <th>حساب ورشة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((l) => (
                      <tr key={l.phone}>
                        <td>{l.workshopName ?? <span className="muted">بدون اسم</span>}</td>
                        <td>
                          <bdi className="num">{l.phone}</bdi>
                        </td>
                        <td className="end num">{l.reviews}</td>
                        <td>
                          <DateTime iso={l.lastSeenAt} ago />
                        </td>
                        <td>
                          {l.organization ? (
                            <span className="row gap-sm">
                              <Link href={`/organizations/${l.organization.id}`}>{l.organization.displayName}</Link> <StatusChip kind="organization" value={l.organization.status} />
                            </span>
                          ) : (
                            <span className="muted">لم يسجّل بعد</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>لا توجد ورش محتملة بعد</Empty>
            )
          }
        </Async>
      </Card>
    </>
  );
}
