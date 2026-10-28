'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Async, Card, Chip, PageHead, Pills } from '@/components/ui';
import { useApi } from '@/lib/hooks';
import { CADENCE_LABEL, pct, WARNING_LABEL } from '@/lib/labels';
import type { PerformanceRow, WindowMetrics } from '@/lib/types';

type Filter = 'all' | 'warnings';

/** Cell that turns red when the value breaches its threshold. */
function Rate({ v, bad }: { v: number | null; bad: boolean }) {
  return <span className={`num ${bad ? 'neg' : ''}`}>{pct(v)}</span>;
}

export function PerformanceView() {
  const state = useApi<{ items: PerformanceRow[] }>('v1/ops/merchants/performance', { live: (e) => e.entityType === 'merchant_order' || e.type.startsWith('return.') });
  const [days, setDays] = useState<'30' | '90'>('30');
  const [filter, setFilter] = useState<Filter>('all');

  return (
    <>
      <PageHead
        title="أداء التجار"
        sub="بطاقة أداء كل تاجر (آخر 30 / 90 يوماً) مع حدود الإنذار المبكر: رفض لنفاد المخزون أعلى من 3%، ونضارة المخزون أقل من 90%."
      />
      <div className="row gap-sm wrap" style={{ marginBlockEnd: 12 }}>
        <Pills label="الفترة" value={days} onChange={setDays} options={[{ value: '30', label: 'آخر 30 يوماً' }, { value: '90', label: 'آخر 90 يوماً' }]} />
        <Pills label="التصفية" value={filter} onChange={setFilter} options={[{ value: 'all', label: 'الكل' }, { value: 'warnings', label: 'بتنبيهات فقط' }]} />
      </div>
      <Card title="التجار (الأقل جودة أولاً)" flush>
        <Async state={state}>
          {(d) => {
            const rows = d.items.filter((r) => filter === 'all' || r.warnings.length > 0);
            return (
              <div className="table-wrap">
                <table className="t" data-testid="performance-table">
                  <thead>
                    <tr>
                      <th>التاجر</th>
                      <th className="end">الدرجة</th>
                      <th className="end">طلبات</th>
                      <th className="end">القبول</th>
                      <th className="end">رفض لنفاد المخزون</th>
                      <th className="end">إلغاء التاجر</th>
                      <th className="end">تجهيز في الموعد</th>
                      <th className="end">مرتجعات خطأ/غير مطابق</th>
                      <th className="end">متوسط القبول</th>
                      <th className="end">نضارة المخزون</th>
                      <th>التنبيهات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const w: WindowMetrics = days === '30' ? r.d30 : r.d90;
                      const t = r.thresholds;
                      return (
                        <tr key={r.merchant.id} data-testid="performance-row" data-merchant={r.merchant.id}>
                          <td>
                            <Link href={`/merchants/${r.merchant.id}`}>{r.merchant.displayNameAr}</Link>
                            <div className="cell-sub">
                              تسوية {CADENCE_LABEL[r.merchant.settlementCadence]}
                              {r.merchant.trustedForEarlyPayout ? ' · صرف مبكر' : ''}
                              {r.merchant.status !== 'APPROVED' ? ' · موقوف' : ''}
                            </div>
                          </td>
                          <td className="end">
                            <strong className={`num ${r.qualityScore < 70 ? 'neg' : ''}`}>{r.qualityScore}</strong>
                          </td>
                          <td className="end num">{w.received}</td>
                          <td className="end">
                            <Rate v={w.acceptanceRate} bad={w.acceptanceRate !== null && w.acceptanceRate < t.acceptanceRate} />
                          </td>
                          <td className="end">
                            <Rate v={w.outOfStockRate} bad={w.outOfStockRate !== null && w.outOfStockRate > t.outOfStockRate} />
                            <div className="cell-sub num">{w.outOfStockRejected}</div>
                          </td>
                          <td className="end">
                            <Rate v={w.cancellationRate} bad={false} />
                          </td>
                          <td className="end">
                            <Rate v={w.onTimeReadyRate} bad={w.onTimeReadyRate !== null && w.onTimeReadyRate < t.onTimeReadyRate} />
                          </td>
                          <td className="end">
                            <Rate v={w.badReturnRate} bad={w.badReturnRate !== null && w.badReturnRate > t.badReturnRate} />
                          </td>
                          <td className="end num">{w.avgAcceptMinutes === null ? '—' : `${w.avgAcceptMinutes} د`}</td>
                          <td className="end">
                            <Rate v={r.offers.freshnessRate} bad={r.offers.freshnessRate !== null && r.offers.freshnessRate < t.freshnessRate} />
                            <div className="cell-sub num">
                              {r.offers.stale}/{r.offers.active} قديمة
                            </div>
                          </td>
                          <td>
                            <div className="row gap-sm wrap">
                              {r.warnings.length ? r.warnings.map((x) => <Chip key={x} tone="danger">{WARNING_LABEL[x] ?? x}</Chip>) : <Chip tone="success">لا تنبيهات</Chip>}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          }}
        </Async>
      </Card>
      <p className="muted small" style={{ marginBlockStart: 12 }}>
        الدرجة (0–100، آخر 90 يوماً) = 30% توفر المخزون (1 − الرفض لنفاد المخزون ÷ 10%) + 20% نضارة المخزون + 15% القبول + 15% التجهيز في الموعد + 10% المرتجعات (1 − النسبة ÷ 10%) + 10% سرعة القبول (15 د → 1، 240 د → 0). كل مكون قائم على الطلبات يُقرَّب نحو 0.8 بوزن 5 طلبات. تُستخدم الدرجة لكسر التعادل في ترتيب العروض فقط، ولا تؤثر على ترتيب البحث.
      </p>
    </>
  );
}
