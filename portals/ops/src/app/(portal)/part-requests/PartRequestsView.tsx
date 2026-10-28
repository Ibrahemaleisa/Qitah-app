'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Fragment, useState } from 'react';

import { Async, Card, Chip, DateTime, Empty, Mono, PageHead, Pager, Pills } from '@/components/ui';
import { qs } from '@/lib/api';
import { cityName, formatMinutes } from '@/lib/format';
import { useApi, useNow } from '@/lib/hooks';
import type { Tone } from '@/lib/labels';
import { formatSar } from '@/lib/money';

type Status = 'OPEN' | 'QUOTED' | 'ACCEPTED' | 'EXPIRED' | 'CANCELLED';
type Row = {
  id: string;
  number: string;
  status: Status;
  vehicle: { label: { ar: string }; engine: string | null };
  description: string;
  partNumber: string | null;
  city: string;
  photoCount: number;
  createdAt: string;
  expiresAt: string;
  firstQuotedAt: string | null;
  quoteCount: number;
  activeQuoteCount: number;
  timeToFirstQuoteSeconds: number | null;
  unansweredOverTarget: boolean;
};
type Metrics = {
  windowDays: number;
  targetMinutes: number;
  targetRate: number;
  total: number;
  answered: number;
  answeredWithinTarget: number;
  withinTargetRate: number | null;
  medianSecondsToFirstQuote: number | null;
  unansweredOverTarget: number;
};
type ListResponse = { total: number; metrics: Metrics; items: Row[] };
type Detail = {
  quotes: {
    id: string;
    status: string;
    merchant: { displayNameAr: string } | null;
    partName: string | null;
    brand: string | null;
    productId: string | null;
    condition: string;
    priceHalalas: number;
    validUntil: string;
    secondsAfterRequest: number;
  }[];
};

const STATUS: Record<Status, [string, Tone]> = {
  OPEN: ['بانتظار العروض', 'warning'],
  QUOTED: ['وصلته عروض', 'info'],
  ACCEPTED: ['اختار العميل عرضاً', 'success'],
  EXPIRED: ['منتهي', 'neutral'],
  CANCELLED: ['ألغاه العميل', 'neutral'],
};
const QUOTE_STATUS: Record<string, [string, Tone]> = {
  ACTIVE: ['قائم', 'info'],
  ACCEPTED: ['فاز', 'success'],
  WITHDRAWN: ['سحبه التاجر', 'neutral'],
  DECLINED: ['لم يُختر', 'neutral'],
  EXPIRED: ['انتهى', 'neutral'],
};
const CONDITION: Record<string, string> = { NEW: 'جديد', USED: 'مستعمل', REFURBISHED: 'مجدد' };

type F = 'ALL' | Status;
const FILTERS: { value: F; label: string }[] = [
  { value: 'ALL', label: 'الكل' },
  { value: 'OPEN', label: 'بانتظار العروض' },
  { value: 'QUOTED', label: 'وصلته عروض' },
  { value: 'ACCEPTED', label: 'مقبولة' },
  { value: 'EXPIRED', label: 'منتهية' },
  { value: 'CANCELLED', label: 'ملغاة' },
];
const LIMIT = 50;

const pct = (r: number | null) => (r === null ? '—' : `${Math.round(r * 100)}%`);
const duration = (sec: number | null) => (sec === null ? '—' : sec < 60 ? `${sec} ث` : formatMinutes(Math.round(sec / 60)));

/** Read-only RFQ monitor: request status, quote counts, time to first quote, and unanswered requests past the 15-minute target. */
export function PartRequestsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const filter = (FILTERS.find((f) => f.value === params.get('f'))?.value ?? 'ALL') as F;
  const [offset, setOffset] = useState(0);
  const [open, setOpen] = useState<string | null>(null);
  const now = useNow(30_000);
  const state = useApi<ListResponse>(`v1/ops/part-requests${qs({ status: filter === 'ALL' ? undefined : filter, limit: LIMIT, offset })}`, {
    live: (e) => e.entityType === 'part_request',
  });

  return (
    <>
      <PageHead title="طلبات القطع (RFQ)" sub="طلبات العملاء للقطع غير الموجودة في الكتالوج وعروض التجار عليها. المستهدف: الرد على 70% من الطلبات خلال 15 دقيقة." />
      <Async state={state}>
        {(d) => (
          <>
            <div className="metrics" data-testid="rfq-metrics" style={{ marginBottom: 12 }}>
              <div className={`metric ${d.metrics.withinTargetRate !== null && d.metrics.withinTargetRate < d.metrics.targetRate ? 'warn-on' : ''}`}>
                <span className="v num">{pct(d.metrics.withinTargetRate)}</span>
                <span className="l">رُدّ عليها خلال {d.metrics.targetMinutes} د (المستهدف {pct(d.metrics.targetRate)})</span>
              </div>
              <div className={`metric ${d.metrics.unansweredOverTarget ? 'alert-on' : ''}`}>
                <span className="v num">{d.metrics.unansweredOverTarget}</span>
                <span className="l">بلا رد منذ أكثر من {d.metrics.targetMinutes} د</span>
              </div>
              <div className="metric">
                <span className="v num">{duration(d.metrics.medianSecondsToFirstQuote)}</span>
                <span className="l">الوسيط حتى أول عرض</span>
              </div>
              <div className="metric">
                <span className="v num">
                  {d.metrics.answered}/{d.metrics.total}
                </span>
                <span className="l">طلبات وصلها عرض (آخر {d.metrics.windowDays} يوماً)</span>
              </div>
            </div>
            <div className="toolbar">
              <Pills
                label="الحالة"
                value={filter}
                onChange={(v) => {
                  setOffset(0);
                  router.replace(`${pathname}?f=${v}`);
                }}
                options={FILTERS}
              />
            </div>
            <Card flush>
              {d.items.length ? (
                <div className="table-wrap">
                  <table className="t" data-testid="rfq-table">
                    <thead>
                      <tr>
                        <th>الطلب</th>
                        <th>السيارة والقطعة</th>
                        <th>المدينة</th>
                        <th>الحالة</th>
                        <th className="end">العروض</th>
                        <th>حتى أول عرض</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((r) => {
                        const waiting = Math.floor((now - new Date(r.createdAt).getTime()) / 60_000);
                        return (
                          <Fragment key={r.id}>
                            <tr className={r.unansweredOverTarget ? 'row-danger' : undefined} data-unanswered={r.unansweredOverTarget || undefined}>
                              <td>
                                <Mono>{r.number}</Mono>
                                <div className="cell-sub">
                                  <DateTime iso={r.createdAt} ago />
                                </div>
                              </td>
                              <td>
                                {r.vehicle.label.ar}
                                <div className="cell-sub">
                                  {r.description.slice(0, 90) || '—'}
                                  {r.partNumber ? (
                                    <>
                                      {' '}
                                      · <Mono>{r.partNumber}</Mono>
                                    </>
                                  ) : null}
                                  {r.photoCount ? ` · ${r.photoCount === 1 ? 'صورة' : `${r.photoCount} صور`}` : ''}
                                </div>
                              </td>
                              <td>{cityName(r.city)}</td>
                              <td>
                                <Chip tone={STATUS[r.status][1]}>{STATUS[r.status][0]}</Chip>
                                {r.unansweredOverTarget ? (
                                  <div className="cell-sub" style={{ color: 'var(--danger)' }}>
                                    بلا رد منذ {formatMinutes(waiting)}
                                  </div>
                                ) : null}
                              </td>
                              <td className="end num">
                                {r.quoteCount}
                                {r.activeQuoteCount && r.activeQuoteCount !== r.quoteCount ? <div className="cell-sub">قائمة {r.activeQuoteCount}</div> : null}
                              </td>
                              <td className="num">{duration(r.timeToFirstQuoteSeconds)}</td>
                              <td>
                                <button type="button" className="btn btn-sm" aria-expanded={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)}>
                                  {open === r.id ? 'إخفاء' : 'العروض'}
                                </button>
                              </td>
                            </tr>
                            {open === r.id ? (
                              <tr>
                                <td colSpan={7}>
                                  <QuotesDetail id={r.id} />
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لا توجد طلبات قطع</Empty>
              )}
            </Card>
            <Pager total={d.total} offset={offset} limit={LIMIT} onChange={setOffset} />
          </>
        )}
      </Async>
    </>
  );
}

function QuotesDetail({ id }: { id: string }) {
  const state = useApi<Detail>(`v1/ops/part-requests/${id}`);
  return (
    <Async state={state} rows={1}>
      {(d) =>
        d.quotes.length ? (
          <table className="t">
            <thead>
              <tr>
                <th>التاجر</th>
                <th>القطعة</th>
                <th>الحالة</th>
                <th className="end">السعر</th>
                <th>بعد الطلب</th>
                <th>صالح حتى</th>
              </tr>
            </thead>
            <tbody>
              {d.quotes.map((q) => (
                <tr key={q.id}>
                  <td>{q.merchant?.displayNameAr ?? '—'}</td>
                  <td>
                    {q.partName ?? (q.productId ? 'منتج من الكتالوج' : '—')}
                    <div className="cell-sub">
                      {q.brand ?? ''} · {CONDITION[q.condition] ?? q.condition}
                    </div>
                  </td>
                  <td>
                    <Chip tone={QUOTE_STATUS[q.status]?.[1] ?? 'neutral'}>{QUOTE_STATUS[q.status]?.[0] ?? q.status}</Chip>
                  </td>
                  <td className="end num">{formatSar(q.priceHalalas)}</td>
                  <td className="num">{duration(q.secondsAfterRequest)}</td>
                  <td>
                    <DateTime iso={q.validUntil} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <Empty>لا توجد عروض بعد</Empty>
        )
      }
    </Async>
  );
}
