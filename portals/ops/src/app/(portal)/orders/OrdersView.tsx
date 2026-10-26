'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Async, Card, DateTime, Empty, Money, PageHead, Pager, StatusChip } from '@/components/ui';
import { qs } from '@/lib/api';
import { useApi, useDebounced } from '@/lib/hooks';
import { STATUS_MAPS } from '@/lib/labels';
import { normalizeDigits } from '@/lib/money';
import type { OrderListItem } from '@/lib/types';

const LIMIT = 50;

export function OrdersView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const status = params.get('status') ?? '';
  const [q, setQ] = useState(params.get('q') ?? '');
  const dq = useDebounced(normalizeDigits(q.trim()));
  const filterKey = `${status}|${dq}`;
  const [page, setPage] = useState({ key: filterKey, offset: 0 });
  const offset = page.key === filterKey ? page.offset : 0;
  const setOffset = (o: number) => setPage({ key: filterKey, offset: o });

  // Keep the box in sync when the global search navigates here with a new ?q=.
  const urlQ = params.get('q') ?? '';
  const [lastUrlQ, setLastUrlQ] = useState(urlQ);
  if (urlQ !== lastUrlQ) {
    setLastUrlQ(urlQ);
    setQ(urlQ);
  }

  const setStatus = (v: string) => {
    const u = new URLSearchParams(params.toString());
    if (v) u.set('status', v);
    else u.delete('status');
    router.replace(`${pathname}${u.size ? `?${u}` : ''}`);
  };

  const state = useApi<{ total: number; items: OrderListItem[] }>(`v1/ops/orders${qs({ status, q: dq, limit: LIMIT, offset })}`, {
    live: (e) => e.type.startsWith('order.') || e.entityType === 'merchant_order',
  });

  return (
    <>
      <PageHead title="الطلبات" sub="ابحث برقم الطلب أو جوال العميل، وافتح أي طلب لتتبعه بالكامل" />
      <div className="toolbar">
        <input type="search" placeholder="رقم الطلب (QT-…) أو رقم الجوال" aria-label="بحث برقم الطلب أو الجوال" value={q} onChange={(e) => setQ(e.target.value)} dir="auto" />
        <select aria-label="تصفية حسب الحالة" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">كل الحالات</option>
          {Object.entries(STATUS_MAPS.order).map(([k, [label]]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
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
                        <th>رقم الطلب</th>
                        <th>التاريخ</th>
                        <th>العميل</th>
                        <th>الحالة</th>
                        <th>الطلبات الفرعية</th>
                        <th className="end">الإجمالي</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((o) => (
                        <tr key={o.id}>
                          <td>
                            <Link href={`/orders/${o.id}`} className="num">
                              {o.number}
                            </Link>
                          </td>
                          <td>
                            <DateTime iso={o.createdAt} />
                          </td>
                          <td>
                            {o.customer.name ?? '—'}
                            <div className="cell-sub num">
                              <bdi>{o.customer.phone}</bdi>
                            </div>
                          </td>
                          <td>
                            <StatusChip kind="order" value={o.status} />
                          </td>
                          <td>
                            <div className="col gap-sm" style={{ alignItems: 'flex-start' }}>
                              {o.merchantOrders.map((m) => (
                                <span key={m.id} className="row gap-sm small">
                                  <span className="muted">{m.merchant.displayNameAr}</span>
                                  <StatusChip kind="merchantOrder" value={m.status} />
                                </span>
                              ))}
                            </div>
                          </td>
                          <td className="end">
                            <Money h={o.totalHalalas} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Pager total={d.total} offset={offset} limit={LIMIT} onChange={setOffset} />
              </>
            ) : (
              <Empty>لا توجد طلبات مطابقة</Empty>
            )
          }
        </Async>
      </Card>
    </>
  );
}
