'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Async, Card, DateTime, Empty, PageHead, Pager, Pills, StatusChip } from '@/components/ui';
import { qs } from '@/lib/api';
import { cityName } from '@/lib/format';
import { useApi, useDebounced } from '@/lib/hooks';
import type { Merchant } from '@/lib/types';

const LIMIT = 50;
type Filter = 'ALL' | 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';
const FILTERS: { value: Filter; label: string }[] = [
  { value: 'ALL', label: 'الكل' },
  { value: 'PENDING', label: 'بانتظار المراجعة' },
  { value: 'APPROVED', label: 'معتمد' },
  { value: 'SUSPENDED', label: 'موقوف' },
  { value: 'REJECTED', label: 'مرفوض' },
];

type ListResp = { total: number; items: Merchant[] };

export function MerchantsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = (FILTERS.find((f) => f.value === params.get('status'))?.value ?? 'ALL') as Filter;
  const [q, setQ] = useState('');
  const dq = useDebounced(q.trim());
  // Offset resets whenever the filter changes (derived, no effect needed).
  const filterKey = `${status}|${dq}`;
  const [page, setPage] = useState({ key: filterKey, offset: 0 });
  const offset = page.key === filterKey ? page.offset : 0;
  const setOffset = (o: number) => setPage({ key: filterKey, offset: o });

  const setStatus = (v: Filter) => router.replace(v === 'ALL' ? pathname : `${pathname}?status=${v}`);

  // "PENDING" spans two API statuses (APPLIED + UNDER_REVIEW): fetch both and merge.
  const isPending = status === 'PENDING';
  const live = { live: (e: { entityType: string }) => e.entityType === 'merchant' };
  const list = useApi<ListResp>(isPending ? null : `v1/ops/merchants${qs({ status: status === 'ALL' ? undefined : status, q: dq, limit: LIMIT, offset })}`, live);
  const applied = useApi<ListResp>(isPending ? `v1/ops/merchants${qs({ status: 'APPLIED', q: dq, limit: 100 })}` : null, live);
  const review = useApi<ListResp>(isPending ? `v1/ops/merchants${qs({ status: 'UNDER_REVIEW', q: dq, limit: 100 })}` : null, live);
  const state = isPending
    ? {
        data: applied.data && review.data ? { total: applied.data.total + review.data.total, items: [...applied.data.items, ...review.data.items] } : undefined,
        error: applied.error ?? review.error,
        loading: applied.loading || review.loading,
        reload: () => (applied.reload(), review.reload()),
      }
    : list;

  return (
    <>
      <PageHead title="التجار" sub="الاعتماد، التحقق، والحالة التشغيلية للتجار" />
      <div className="toolbar">
        <Pills label="تصفية حسب الحالة" value={status} onChange={setStatus} options={FILTERS} />
        <input type="search" placeholder="بحث بالاسم أو رقم السجل التجاري" aria-label="بحث في التجار" value={q} onChange={(e) => setQ(e.target.value)} />
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
                        <th>التاجر</th>
                        <th>السجل التجاري</th>
                        <th>المدينة</th>
                        <th>الحالة</th>
                        <th className="end">العروض</th>
                        <th className="end">المواقع</th>
                        <th className="end">الطلبات</th>
                        <th>العمولة</th>
                        <th>تاريخ الانضمام</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <Link href={`/merchants/${m.id}`}>{m.displayNameAr}</Link>
                            <div className="cell-sub">{m.displayNameEn}</div>
                          </td>
                          <td className="num">{m.crNumber}</td>
                          <td>{cityName(m.city)}</td>
                          <td>
                            <StatusChip kind="merchant" value={m.status} />
                          </td>
                          <td className="end num">{m._count.offers}</td>
                          <td className="end num">{m._count.locations ?? '—'}</td>
                          <td className="end num">{m._count.merchantOrders}</td>
                          <td className="num">{(m.commissionBps / 100).toFixed(2)}%</td>
                          <td>
                            <DateTime iso={m.createdAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {status !== 'PENDING' ? <Pager total={d.total} offset={offset} limit={LIMIT} onChange={setOffset} /> : null}
              </>
            ) : (
              <Empty>لا يوجد تجار مطابقون</Empty>
            )
          }
        </Async>
      </Card>
    </>
  );
}
