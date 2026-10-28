'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { OrgNav, type OrgCredit, type OrgRow } from '@/components/OrgNav';
import { Async, Card, DateTime, Empty, Money, PageHead, Pager, Pills, StatusChip } from '@/components/ui';
import { qs } from '@/lib/api';
import { cityName } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';

const LIMIT = 50;
type Filter = 'ALL' | 'APPLIED' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'الكل' },
  { value: 'APPLIED', label: 'بانتظار المراجعة' },
  { value: 'APPROVED', label: 'معتمدة' },
  { value: 'SUSPENDED', label: 'موقوفة' },
  { value: 'REJECTED', label: 'مرفوضة' },
];

type Row = OrgRow & { members: number; orders: number; credit: OrgCredit | null };

/** Workshop / fleet organisations: review applications, credit lines at a glance. */
export function OrganizationsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = (FILTERS.find((f) => f.value === params.get('status'))?.value ?? 'ALL') as Filter;
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  const filterKey = `${status}|${dq}`;
  const [page, setPage] = useState({ key: filterKey, offset: 0 });
  const offset = page.key === filterKey ? page.offset : 0;
  const state = useApi<{ total: number; items: Row[] }>(`v1/ops/organizations${qs({ status: status === 'ALL' ? undefined : status, q: dq, limit: LIMIT, offset })}`, {
    live: (e) => e.entityType === 'organization',
  });

  return (
    <>
      <PageHead title="الورش" sub="حسابات الورش والأساطيل: الاعتماد، الدفع الآجل (حد ائتماني تجريبي داخلي من قطعة)، والسداد" />
      <OrgNav />
      <div className="toolbar">
        <Pills label="تصفية حسب الحالة" value={status} onChange={(v) => router.replace(v === 'ALL' ? pathname : `${pathname}?status=${v}`)} options={FILTERS} />
        <input type="search" placeholder="بحث بالاسم أو رقم السجل التجاري" aria-label="بحث في الورش" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <Card flush>
        <Async state={state}>
          {(d) =>
            d.items.length ? (
              <>
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>الورشة</th>
                        <th>السجل التجاري</th>
                        <th>المدينة</th>
                        <th>الحالة</th>
                        <th>الآجل</th>
                        <th className="end">المستحق</th>
                        <th className="end">المتاح</th>
                        <th className="end">الأعضاء</th>
                        <th className="end">الطلبات</th>
                        <th>التسجيل</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <Link href={`/organizations/${o.id}`}>{o.displayName}</Link>
                            <div className="cell-sub">{o.legalName}</div>
                          </td>
                          <td className="num">{o.crNumber}</td>
                          <td>{cityName(o.city)}</td>
                          <td>
                            <StatusChip kind="organization" value={o.status} />
                          </td>
                          <td>{o.credit?.status ? <StatusChip kind="credit" value={o.credit.status} /> : <span className="muted">—</span>}</td>
                          <td className="end">{o.credit ? <Money h={o.credit.outstandingHalalas} /> : '—'}</td>
                          <td className="end">{o.credit ? <Money h={o.credit.availableHalalas} /> : '—'}</td>
                          <td className="end num">{o.members}</td>
                          <td className="end num">{o.orders}</td>
                          <td>
                            <DateTime iso={o.createdAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager total={d.total} offset={offset} limit={LIMIT} onChange={(o) => setPage({ key: filterKey, offset: o })} />
              </>
            ) : (
              <Empty>لا توجد ورش مطابقة</Empty>
            )
          }
        </Async>
      </Card>
    </>
  );
}
