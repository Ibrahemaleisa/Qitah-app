'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

import { ShipmentActions, ShipmentTimeline } from '@/components/ops';
import { Async, Card, Chip, DateTime, KV, Money, Mono, PageHead, SandboxTag, StatusChip } from '@/components/ui';
import { cityName, formatWeight } from '@/lib/format';
import { useApi, useNow } from '@/lib/hooks';
import { DIRECTION_LABEL, SERVICE_LABEL } from '@/lib/labels';
import type { ShipmentDetail } from '@/lib/types';

export function ShipmentDetailView() {
  const { id } = useParams<{ id: string }>();
  const now = useNow(60_000);
  const state = useApi<ShipmentDetail>(`v1/ops/shipments/${id}`, { live: (e) => e.entityType === 'shipment' && e.entityId === id });
  return (
    <Async state={state} rows={8}>
      {(s) => {
        const a = s.order.addressSnapshot ?? {};
        const loc = s.originLocation;
        const merchant = s.merchantOrder.merchant;
        const outbound = s.direction === 'OUTBOUND';
        const originText = `${merchant.displayNameAr} — ${loc.name}، ${loc.street}، ${loc.district}، ${cityName(loc.city)}`;
        const customerText = `${a.contactName ?? '—'} — ${[a.street, a.district, cityName(a.city)].filter(Boolean).join('، ')}`;
        const overdue = s.status === 'PICKUP_SCHEDULED' && s.pickupWindowEnd && new Date(s.pickupWindowEnd).getTime() < now;
        return (
          <>
            <PageHead
              crumbs={[{ href: '/tower', label: 'برج التحكم' }]}
              title={
                <span className="row gap-sm wrap">
                  شحنة {s.trackingNumber ? <Mono>{s.trackingNumber}</Mono> : <span className="muted">بدون بوليصة</span>}
                  <span data-testid="shipment-status">
                    <StatusChip kind="shipment" value={s.status} />
                  </span>
                  <Chip tone={outbound ? 'neutral' : 'warning'}>{DIRECTION_LABEL[s.direction]}</Chip>
                  {s.sandbox ? <SandboxTag>ناقل تجريبي</SandboxTag> : null}
                </span>
              }
              sub={
                <>
                  الطلب <Link href={`/orders/${s.order.id}`} className="num">{s.order.number}</Link> · الطلب الفرعي <span className="num">{s.merchantOrder.number}</span>
                  {s.returnCase ? <> · المرتجع <Link href={`/returns?focus=${s.returnCase.id}`} className="num">{s.returnCase.number}</Link></> : null}
                </>
              }
            />
            <div className="grid grid-main-side">
              <div className="stack">
                <Card title="الإجراءات">
                  {overdue ? <div className="alert alert-warning" style={{ marginBlockEnd: 10 }}>انقضت نافذة الاستلام دون تسجيل استلام من الناقل.</div> : null}
                  {s.exceptionReason ? <div className="alert alert-danger" style={{ marginBlockEnd: 10 }}>{s.exceptionReason}</div> : null}
                  <ShipmentActions shipment={s} onDone={state.reload} preface={overdue ? 'PICKUP_FAILED' : undefined} />
                </Card>
                <Card title="المسار">
                  <KV
                    items={[
                      ['من (موقع الاستلام)', outbound ? originText : customerText],
                      ['جوال الاستلام', <bdi key="p" className="num">{outbound ? loc.contactPhone : a.phone}</bdi>],
                      ['إلى', outbound ? customerText : originText],
                      ['جوال المستلم', <bdi key="p2" className="num">{outbound ? a.phone : loc.contactPhone}</bdi>],
                    ]}
                  />
                </Card>
                <Card title="أحداث التتبع">
                  <ShipmentTimeline events={s.events} />
                </Card>
              </div>
              <div className="stack">
                <Card title="الخدمة">
                  <KV
                    items={[
                      ['الناقل', s.carrierCode],
                      ['الخدمة', SERVICE_LABEL[s.serviceCode] ?? s.serviceCode],
                      ['التكلفة المسعّرة', <Money key="c" h={s.costHalalas} />],
                      ['الوزن', formatWeight(s.weightGrams)],
                      ['نافذة الاستلام', s.pickupWindowStart ? <span key="w"><DateTime iso={s.pickupWindowStart} /> – <DateTime iso={s.pickupWindowEnd} /></span> : null],
                      ['البوليصة', s.labelUrl ? <a key="l" href={s.labelUrl} target="_blank" rel="noopener noreferrer">فتح</a> : null],
                      ['أُنشئت', <DateTime key="cr" iso={s.createdAt} />],
                      ['آخر تحديث', <DateTime key="u" iso={s.updatedAt} />],
                    ]}
                  />
                </Card>
                <Card title="الطلب الفرعي">
                  <div className="row gap-sm wrap" style={{ marginBlockEnd: 8 }}>
                    <Link href={`/merchants/${merchant.id}`}>{merchant.displayNameAr}</Link>
                    <StatusChip kind="merchantOrder" value={s.merchantOrder.status} />
                  </div>
                  <table className="t">
                    <tbody>
                      {s.merchantOrder.items
                        .filter((i) => !s.fulfillmentGroupId || i.fulfillmentGroupId === s.fulfillmentGroupId)
                        .map((i) => (
                          <tr key={i.id}>
                            <td>{i.productNameAr}</td>
                            <td className="end num">× {i.quantity}</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>
          </>
        );
      }}
    </Async>
  );
}
