'use client';

import Link from 'next/link';

import { useLiveStatus } from '@/components/LiveEvents';
import { Async, Card, DateTime, Empty, PageHead } from '@/components/ui';
import { useApi } from '@/lib/hooks';
import { eventLabel, statusLabel } from '@/lib/labels';
import type { LiveEvent, Notification, Summary } from '@/lib/types';

const METRICS: { key: keyof Summary; label: string; href: string; alert?: boolean; warn?: boolean }[] = [
  { key: 'exceptions', label: 'استثناءات الشحن', href: '/exceptions', alert: true },
  { key: 'slaBreaches', label: 'تجاوز مهلة التاجر', href: '/exceptions#sla', alert: true },
  { key: 'awaitingAcceptance', label: 'بانتظار قبول التاجر', href: '/tower/queue?stage=NEW', warn: true },
  { key: 'readyForPickup', label: 'جاهز للاستلام', href: '/tower/queue?stage=READY_FOR_PICKUP' },
  { key: 'activeShipments', label: 'شحنات نشطة', href: '/tower' },
  { key: 'ordersToday', label: 'طلبات آخر 24 ساعة', href: '/orders' },
  { key: 'openReturns', label: 'مرتجعات مفتوحة', href: '/returns' },
  { key: 'pendingRefunds', label: 'استردادات معلّقة', href: '/finance#payments' },
  { key: 'pendingMerchants', label: 'تجار بانتظار المراجعة', href: '/merchants?status=PENDING', warn: true },
  { key: 'approvedMerchants', label: 'تجار معتمدون', href: '/merchants?status=APPROVED' },
];

function eventHref(e: LiveEvent): string | undefined {
  if (e.entityType === 'shipment') return `/tower/shipments/${e.entityId}`;
  if (e.entityType === 'merchant') return `/merchants/${e.entityId}`;
  if (e.entityType === 'return_case') return '/returns';
  if (e.orderId) return `/orders/${e.orderId}`;
  if (e.entityType === 'order') return `/orders/${e.entityId}`;
  return undefined;
}

function eventDetail(e: LiveEvent): string {
  const p = e.payload ?? {};
  const status = typeof p.status === 'string' ? p.status : typeof p.to === 'string' ? p.to : undefined;
  if (!status) return '';
  if (e.entityType === 'shipment') return statusLabel('shipment', status);
  if (e.entityType === 'merchant_order') return statusLabel('merchantOrder', status);
  if (e.entityType === 'return_case') return statusLabel('return', status);
  if (e.entityType === 'merchant') return statusLabel('merchant', status);
  return status;
}

export function OverviewView() {
  const summary = useApi<Summary>('v1/ops/summary', { live: () => true });
  const notes = useApi<{ notifications: Notification[] }>('v1/ops/notifications', { live: () => true });
  const { recent, connected } = useLiveStatus();

  return (
    <>
      <PageHead title="نظرة عامة" sub="حالة المنصة الآن — كل بطاقة تفتح الطابور المعني" />
      <div className="stack">
        <Async state={summary} rows={2}>
          {(s) => (
            <div className="metrics" data-testid="metrics">
              {METRICS.map((m) => {
                const v = s[m.key] as number;
                const cls = v > 0 && m.alert ? 'alert-on' : v > 0 && m.warn ? 'warn-on' : '';
                return (
                  <Link key={m.key} href={m.href} className={`metric ${cls}`}>
                    <span className="v num">{v}</span>
                    <span className="l">{m.label}</span>
                  </Link>
                );
              })}
            </div>
          )}
        </Async>
        <div className="grid grid-2">
          <Card title="النشاط المباشر" actions={<span className="muted small">{connected ? 'يصل لحظياً' : 'متوقف — يتم التحديث الدوري'}</span>} flush>
            {recent.length ? (
              <ul className="feed" style={{ padding: '0 16px' }} data-testid="live-feed">
                {recent.map((e) => {
                  const href = eventHref(e);
                  return (
                    <li key={e.id}>
                      <span>
                        {href ? <Link href={href}>{eventLabel(e.type)}</Link> : eventLabel(e.type)} <span className="muted">{eventDetail(e)}</span>
                      </span>
                      <DateTime iso={e.createdAt} ago />
                    </li>
                  );
                })}
              </ul>
            ) : (
              <Empty>لا نشاط منذ فتح الصفحة. ستظهر الأحداث هنا فور حدوثها.</Empty>
            )}
          </Card>
          <Card title="تنبيهات العمليات" flush>
            <Async state={notes}>
              {(d) =>
                d.notifications.length ? (
                  <ul className="feed" style={{ padding: '0 16px' }}>
                    {d.notifications.slice(0, 25).map((n) => (
                      <li key={n.id}>
                        <span>
                          <NotificationLink n={n} /> <span className="muted">{n.body}</span>
                        </span>
                        <DateTime iso={n.createdAt} ago />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <Empty>لا توجد تنبيهات</Empty>
                )
              }
            </Async>
          </Card>
        </div>
      </div>
    </>
  );
}

function NotificationLink({ n }: { n: Notification }) {
  const d = n.data ?? {};
  const href =
    typeof d.shipmentId === 'string'
      ? `/tower/shipments/${d.shipmentId}`
      : typeof d.orderId === 'string'
        ? `/orders/${d.orderId}`
        : typeof d.merchantOrderId === 'string'
          ? '/tower/queue'
          : typeof d.returnCaseId === 'string'
            ? '/returns'
            : typeof d.merchantId === 'string'
              ? `/merchants/${d.merchantId}`
              : undefined;
  return href ? <Link href={href}>{n.title}</Link> : <strong>{n.title}</strong>;
}
