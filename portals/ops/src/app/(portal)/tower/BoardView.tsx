'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { ShipmentActions } from '@/components/ops';
import { useSession } from '@/components/Session';
import { useToast } from '@/components/Toasts';
import { TowerNav } from '@/components/TowerNav';
import { Async, Chip, DateTime, ErrorBox, Mono, PageHead, Pills, SandboxTag, StatusChip } from '@/components/ui';
import { post, qs } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cityName, formatDate, formatTime } from '@/lib/format';
import { useApi, useNow } from '@/lib/hooks';
import { DIRECTION_LABEL, SERVICE_LABEL, statusLabel } from '@/lib/labels';
import { EXCEPTION_STATUSES, IN_TRANSIT_STATUSES } from '@/lib/states';
import type { ShipmentListItem, ShipmentStatus } from '@/lib/types';

type Dir = 'ALL' | 'OUTBOUND' | 'RETURN';
const ACTIVE: ShipmentStatus[] = ['PENDING', 'LABEL_CREATED', 'PICKUP_SCHEDULED', ...IN_TRANSIT_STATUSES, ...EXCEPTION_STATUSES];
const LANES: { key: string; title: string; statuses: ShipmentStatus[]; danger?: boolean }[] = [
  { key: 'pending', title: 'بانتظار البوليصة', statuses: ['PENDING'] },
  { key: 'label', title: 'أُنشئت البوليصة', statuses: ['LABEL_CREATED'] },
  { key: 'pickup', title: 'موعد استلام محدد', statuses: ['PICKUP_SCHEDULED'] },
  { key: 'transit', title: 'مع الناقل', statuses: IN_TRANSIT_STATUSES },
  { key: 'exceptions', title: 'استثناءات', statuses: EXCEPTION_STATUSES, danger: true },
  { key: 'delivered', title: 'سُلّمت مؤخراً', statuses: ['DELIVERED'] },
];

export function BoardView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const dir = (['OUTBOUND', 'RETURN'].includes(params.get('dir') ?? '') ? params.get('dir') : 'ALL') as Dir;
  const direction = dir === 'ALL' ? undefined : dir;
  const live = { live: (e: { entityType: string }) => e.entityType === 'shipment' || e.entityType === 'merchant_order' || e.entityType === 'return_case' };
  const active = useApi<{ total: number; items: ShipmentListItem[] }>(`v1/ops/shipments${qs({ status: ACTIVE.join(','), direction, limit: 100 })}`, live);
  const delivered = useApi<{ total: number; items: ShipmentListItem[] }>(`v1/ops/shipments${qs({ status: 'DELIVERED', direction, limit: 15 })}`, live);
  const { has, sandbox } = useSession();
  const { push } = useToast();
  const [bulk, setBulk] = useState<string | null>(null);

  const reload = () => {
    active.reload();
    delivered.reload();
  };
  const all = [...(active.data?.items ?? []), ...(delivered.data?.items ?? [])];
  const readyForLabel = (active.data?.items ?? []).filter((s) => s.status === 'PENDING' && s.direction === 'OUTBOUND' && s.merchantOrder.status === 'READY_FOR_PICKUP');

  async function bulkLabels() {
    let ok = 0;
    const failed: string[] = [];
    for (const [i, s] of readyForLabel.entries()) {
      setBulk(`${i + 1}/${readyForLabel.length}`);
      try {
        await post(`v1/ops/shipments/${s.id}/label`);
        ok += 1;
      } catch (e) {
        failed.push(`${s.merchantOrder.number}: ${errorMessage(e)}`);
      }
    }
    setBulk(null);
    push({ tone: failed.length ? 'warning' : 'success', title: `أُنشئت ${ok} بوليصة`, body: failed.length ? `فشل ${failed.length}: ${failed.join(' · ')}` : undefined });
    reload();
  }

  return (
    <>
      <PageHead
        title="برج التحكم"
        sub="كل شحنة من موقع التاجر إلى العميل — الحالة، الخطوة التالية، والإجراء"
        actions={
          has('OPS_AGENT') && readyForLabel.length ? (
            <button className="btn btn-primary" onClick={bulkLabels} disabled={!!bulk} data-testid="bulk-labels">
              {bulk ? `جارٍ الإنشاء ${bulk}` : `إنشاء بوالص لكل الجاهزة (${readyForLabel.length})`}
            </button>
          ) : null
        }
      />
      <TowerNav />
      <div className="toolbar">
        <Pills
          label="اتجاه الشحنة"
          value={dir}
          onChange={(v) => router.replace(v === 'ALL' ? pathname : `${pathname}?dir=${v}`)}
          options={[
            { value: 'ALL', label: 'الكل' },
            { value: 'OUTBOUND', label: 'صادرة للعملاء' },
            { value: 'RETURN', label: 'مرتجعات' },
          ]}
        />
        {sandbox ? <SandboxTag>الناقل تجريبي: أزرار المحاكاة ترسل webhook موقّعاً عبر المسار الحقيقي</SandboxTag> : null}
      </div>
      {delivered.error ? <ErrorBox error={delivered.error} onRetry={delivered.reload} /> : null}
      <Async state={active} rows={6}>
        {() => (
          <div className="board" data-testid="board">
            {LANES.map((lane) => {
              const items = all.filter((s) => lane.statuses.includes(s.status));
              return (
                <section key={lane.key} className={`lane ${lane.danger ? 'lane-danger' : ''}`} aria-label={lane.title} data-lane={lane.key}>
                  <div className="lane-head">
                    <span>{lane.title}</span>
                    <span className={`count ${lane.danger && items.length ? 'count-danger' : ''}`}>{items.length}</span>
                  </div>
                  {items.map((s) => (
                    <ShipmentCard key={s.id} s={s} onDone={reload} />
                  ))}
                  {!items.length ? <div className="muted small" style={{ padding: 8 }}>لا شيء</div> : null}
                </section>
              );
            })}
          </div>
        )}
      </Async>
    </>
  );
}

function ShipmentCard({ s, onDone }: { s: ShipmentListItem; onDone: () => void }) {
  const now = useNow(60_000);
  const last = s.events[0];
  const addr = s.order.addressSnapshot ?? {};
  const overdue = s.status === 'PICKUP_SCHEDULED' && s.pickupWindowEnd && new Date(s.pickupWindowEnd).getTime() < now;
  return (
    <article className="ship-card" data-shipment={s.id} data-status={s.status} data-order={s.order.number}>
      <div className="top">
        <Link href={`/tower/shipments/${s.id}`} className="num">
          <strong>{s.merchantOrder.number}</strong>
        </Link>
        <span className="row gap-sm">
          {s.direction === 'RETURN' ? <Chip tone="warning">{DIRECTION_LABEL.RETURN}</Chip> : null}
          <StatusChip kind="shipment" value={s.status} />
        </span>
      </div>
      <div className="route">
        {s.direction === 'RETURN' ? (
          <>
            العميل ({cityName(addr.city)}{addr.district ? ` / ${addr.district}` : ''}) ← {s.merchantOrder.merchant.displayNameAr} · {s.originLocation.name}
          </>
        ) : (
          <>
            {s.merchantOrder.merchant.displayNameAr} · {s.originLocation.name} ({cityName(s.originLocation.city)}) ← {cityName(addr.city)}
            {addr.district ? ` / ${addr.district}` : ''}
          </>
        )}
      </div>
      <div className="row gap-sm wrap muted small">
        <span>{SERVICE_LABEL[s.serviceCode] ?? s.serviceCode}</span>
        {s.trackingNumber ? <Mono>{s.trackingNumber}</Mono> : null}
        {s.direction === 'OUTBOUND' && s.merchantOrder.status !== 'READY_FOR_PICKUP' && s.status === 'PENDING' ? <span>التاجر: {statusLabel('merchantOrder', s.merchantOrder.status)}</span> : null}
      </div>
      {s.pickupWindowStart ? (
        <div className={`small ${overdue ? 'sla-breach' : 'muted'}`}>
          {overdue ? 'تجاوز نافذة الاستلام · ' : 'الاستلام: '}
          <bdi className="num" dir="ltr">
            {formatTime(s.pickupWindowStart)}–{formatTime(s.pickupWindowEnd)}
          </bdi>{' '}
          · {formatDate(s.pickupWindowStart)}
        </div>
      ) : null}
      {s.exceptionReason ? <div className="small sla-breach">{s.exceptionReason}</div> : null}
      {last && !s.exceptionReason ? (
        <div className="small muted">
          آخر حدث: {last.description} · <DateTime iso={last.occurredAt} ago />
        </div>
      ) : null}
      <ShipmentActions shipment={s} onDone={onDone} compact preface={overdue ? 'PICKUP_FAILED' : undefined} />
    </article>
  );
}
