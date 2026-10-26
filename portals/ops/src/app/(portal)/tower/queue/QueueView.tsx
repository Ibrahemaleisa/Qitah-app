'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import { MerchantOrderActions, ShipmentActions, SlaCell } from '@/components/ops';
import { TowerNav } from '@/components/TowerNav';
import { Async, Card, Chip, Empty, PageHead, Pills, StatusChip } from '@/components/ui';
import { cityName } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import type { MerchantOrderStatus, QueueItem } from '@/lib/types';

type Stage = 'ALL' | Extract<MerchantOrderStatus, 'NEW' | 'ACCEPTED' | 'PACKING' | 'READY_FOR_PICKUP'>;
const STAGES: { value: Stage; label: string }[] = [
  { value: 'ALL', label: 'الكل' },
  { value: 'NEW', label: 'بانتظار القبول' },
  { value: 'ACCEPTED', label: 'مقبول' },
  { value: 'PACKING', label: 'قيد التغليف' },
  { value: 'READY_FOR_PICKUP', label: 'جاهز للاستلام' },
];

export function QueueView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const stage = (STAGES.find((s) => s.value === params.get('stage'))?.value ?? 'ALL') as Stage;
  const state = useApi<{ items: QueueItem[] }>('v1/ops/fulfillment/queue', { live: (e) => e.entityType === 'merchant_order' || e.entityType === 'shipment' || e.type === 'order.paid' });

  return (
    <>
      <PageHead title="برج التحكم" sub="الطلبات الفرعية لدى التجار حسب المرحلة، مع مهلة الخدمة وموقع الاستلام" />
      <TowerNav />
      <Async state={state} rows={6}>
        {(d) => {
          const counts = Object.fromEntries(STAGES.map((s) => [s.value, s.value === 'ALL' ? d.items.length : d.items.filter((i) => i.status === s.value).length]));
          const rows = d.items
            .filter((i) => stage === 'ALL' || i.status === stage)
            .sort((a, b) => (a.slaDueAt && b.slaDueAt ? new Date(a.slaDueAt).getTime() - new Date(b.slaDueAt).getTime() : a.slaDueAt ? -1 : 1));
          return (
            <>
              <div className="toolbar">
                <Pills label="المرحلة" value={stage} onChange={(v) => router.replace(v === 'ALL' ? pathname : `${pathname}?stage=${v}`)} options={STAGES.map((s) => ({ ...s, count: counts[s.value] }))} />
              </div>
              <Card flush>
                {rows.length ? (
                  <div className="table-wrap">
                    <table className="t" data-testid="queue">
                      <thead>
                        <tr>
                          <th>الطلب الفرعي</th>
                          <th>التاجر</th>
                          <th>المرحلة</th>
                          <th>المهلة</th>
                          <th>موقع الاستلام</th>
                          <th>الوجهة</th>
                          <th>الأصناف</th>
                          <th>الإجراء</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((m) => {
                          const shipment = m.shipments[0];
                          const overdue = m.slaBreached || (m.slaDueAt !== null && (m.slaMinutesLeft ?? 0) < 0);
                          return (
                            <tr key={m.id} className={overdue ? 'row-danger' : ''} data-mo={m.number}>
                              <td>
                                <Link href={`/orders/${m.order.id}`} className="num">
                                  {m.number}
                                </Link>
                              </td>
                              <td>
                                <Link href={`/merchants/${m.merchant.id}`}>{m.merchant.displayNameAr}</Link>
                              </td>
                              <td>
                                <StatusChip kind="merchantOrder" value={m.status} />
                                {shipment ? (
                                  <div style={{ marginBlockStart: 4 }}>
                                    <StatusChip kind="shipment" value={shipment.status} />
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                {m.status === 'READY_FOR_PICKUP' ? <span className="muted small">بانتظار الناقل</span> : <SlaCell due={m.slaDueAt} breached={m.slaBreached} label={m.status === 'NEW' ? 'مهلة القبول' : 'مهلة التجهيز'} />}
                                {m.slaBreached ? (
                                  <div>
                                    <Chip tone="danger">تجاوز المهلة</Chip>
                                  </div>
                                ) : null}
                              </td>
                              <td>
                                {m.groups.map((g) => (
                                  <div key={g.id}>
                                    {g.originLocation.name} <span className="cell-sub">({cityName(g.originLocation.city)})</span>
                                  </div>
                                ))}
                              </td>
                              <td>
                                {cityName(m.order.addressSnapshot?.city)}
                                {m.order.addressSnapshot?.district ? <div className="cell-sub">{m.order.addressSnapshot.district}</div> : null}
                              </td>
                              <td className="small">
                                {m.items.map((it, i) => (
                                  <div key={i}>
                                    {it.productNameAr} × <span className="num">{it.quantity}</span>
                                  </div>
                                ))}
                              </td>
                              <td>
                                {m.status === 'READY_FOR_PICKUP' && shipment ? (
                                  <ShipmentActions shipment={shipment} onDone={state.reload} compact />
                                ) : (
                                  <MerchantOrderActions id={m.id} number={m.number} status={m.status} onDone={state.reload} />
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <Empty>لا توجد طلبات في هذه المرحلة</Empty>
                )}
              </Card>
            </>
          );
        }}
      </Async>
    </>
  );
}
