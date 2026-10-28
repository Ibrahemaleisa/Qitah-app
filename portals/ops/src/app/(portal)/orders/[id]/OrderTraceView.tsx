'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';

import { MerchantOrderActions, ShipmentActions, ShipmentTimeline, SlaCell } from '@/components/ops';
import { useSession } from '@/components/Session';
import { Async, Card, Chip, DateTime, Empty, JsonDetails, KV, Money, Mono, PageHead, SandboxTag, StatusChip } from '@/components/ui';
import { cityName, formatWeight, shortId } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { ACCOUNT_LABEL, ACTOR_LABEL, auditLabel, DIRECTION_LABEL, ENTITY_LABEL, PAYMENT_METHOD_LABEL, POSTING_LABEL, RETURN_REASON_LABEL, SERVICE_LABEL, webhookOutcomeTone } from '@/lib/labels';
import { ACTIVE_MO } from '@/lib/states';
import type { LedgerEntry, OrderTrace } from '@/lib/types';

import { RefundDialog } from './RefundDialog';

const SECTIONS = [
  ['summary', 'الملخص'],
  ['suborders', 'الطلبات الفرعية'],
  ['items', 'الأصناف'],
  ['shipping', 'الشحن'],
  ['payments', 'المدفوعات'],
  ['refunds', 'الاستردادات'],
  ['returns', 'المرتجعات'],
  ['ledger', 'القيود'],
  ['reconciliation', 'المطابقة'],
  ['audit', 'سجل التدقيق'],
] as const;

export function OrderTraceView() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<OrderTrace>(`v1/ops/orders/${id}`, { live: (e) => e.orderId === id || e.entityId === id });
  return (
    <Async state={state} rows={10}>
      {(t) => <Trace t={t} reload={state.reload} />}
    </Async>
  );
}

function Trace({ t, reload }: { t: OrderTrace; reload: () => void }) {
  const { order: o, reconciliation: r, auditTrail } = t;
  const { has } = useSession();
  const [refundOpen, setRefundOpen] = useState(false);
  const moNumber = useMemo(() => Object.fromEntries(o.merchantOrders.map((m) => [m.id, m.number])), [o.merchantOrders]);
  const addr = o.addressSnapshot ?? {};
  const outboundByGroup = (gid: string) => o.shipments.filter((s) => s.fulfillmentGroupId === gid);
  const returnShipments = o.shipments.filter((s) => s.direction === 'RETURN');
  const ungroupedOutbound = o.shipments.filter((s) => s.direction === 'OUTBOUND' && !o.groups.some((g) => g.id === s.fulfillmentGroupId));
  const postings = useMemo(() => {
    const map = new Map<string, LedgerEntry[]>();
    for (const e of o.ledgerEntries) map.set(e.postingId, [...(map.get(e.postingId) ?? []), e]);
    return [...map.values()];
  }, [o.ledgerEntries]);
  const canRefund = has('FINANCE') && o.payments.some((p) => ['CAPTURED', 'PARTIALLY_REFUNDED'].includes(p.status));

  return (
    <>
      <PageHead
        crumbs={[{ href: '/orders', label: 'الطلبات' }]}
        title={
          <span className="row gap-sm wrap">
            <span className="num">{o.number}</span>
            <StatusChip kind="order" value={o.status} />
            {o.sandbox ? <SandboxTag>طلب تجريبي</SandboxTag> : null}
          </span>
        }
        sub={
          <>
            أُنشئ <DateTime iso={o.createdAt} /> · دُفع <DateTime iso={o.paidAt} /> · {PAYMENT_METHOD_LABEL[o.paymentMethod] ?? o.paymentMethod}
          </>
        }
        actions={
          canRefund ? (
            <button className="btn" onClick={() => setRefundOpen(true)} data-testid="open-refund">
              استرداد جزئي / تعويض
            </button>
          ) : null
        }
      />
      <nav className="anchor-nav" aria-label="أقسام الطلب">
        {SECTIONS.map(([k, l]) => (
          <a key={k} href={`#${k}`}>
            {l}
          </a>
        ))}
      </nav>

      <div className="stack">
        <div className="grid grid-main-side" id="summary">
          <Card title="المبالغ">
            <KV
              items={[
                ['الأصناف', <Money key="i" h={o.itemsHalalas} />],
                ['الشحن', <Money key="s" h={o.shippingHalalas} />],
                ['الخصم', <Money key="d" h={o.discountHalalas} />],
                ['الإجمالي', <strong key="t"><Money h={o.totalHalalas} /></strong>],
                ['منها ضريبة القيمة المضافة', <Money key="v" h={o.vatHalalas} />],
                ['المسترد', <Money key="r" h={o.refundedHalalas} />],
              ]}
            />
            {o.cancelReason ? <div className="alert alert-warning" style={{ marginBlockStart: 12 }}>سبب الإلغاء: {o.cancelReason}</div> : null}
          </Card>
          <Card title="العميل والعنوان">
            <KV
              items={[
                ['العميل', o.customer.name ?? '—'],
                ['الجوال', <bdi key="p" className="num">{o.customer.phone}</bdi>],
                ['المستلم', addr.contactName ?? '—'],
                ['جوال المستلم', <bdi key="p2" className="num">{addr.phone}</bdi>],
                ['العنوان', [addr.street, addr.district, cityName(addr.city)].filter(Boolean).join('، ')],
                ['النوع', addr.kind === 'WORKSHOP' ? `ورشة${addr.workshopName ? ` — ${addr.workshopName}` : ''}` : 'منزل'],
                ...(o.vehicleSnapshot?.label ? ([['المركبة', o.vehicleSnapshot.label]] as [string, string][]) : []),
              ]}
            />
          </Card>
        </div>

        <Card title="الطلبات الفرعية (لكل تاجر)" id="suborders" flush>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>الرقم</th>
                  <th>التاجر</th>
                  <th>الحالة</th>
                  <th>المهلة</th>
                  <th className="end">الأصناف</th>
                  <th className="end">الشحن</th>
                  <th className="end">العمولة</th>
                  <th>الإجراءات (نيابةً عن التاجر)</th>
                </tr>
              </thead>
              <tbody>
                {o.merchantOrders.map((m) => {
                  const due = m.status === 'NEW' ? m.acceptBy : m.readyBy;
                  return (
                    <tr key={m.id} className={m.slaBreached && ACTIVE_MO.includes(m.status) ? 'row-danger' : ''}>
                      <td className="num">{m.number}</td>
                      <td>
                        <Link href={`/merchants/${m.merchantId}`}>{m.merchant.displayNameAr}</Link>
                        <div className="cell-sub">{cityName(m.merchant.city)}</div>
                      </td>
                      <td>
                        <StatusChip kind="merchantOrder" value={m.status} />
                        {m.rejectedReason ? <div className="cell-sub">{m.rejectedReason}</div> : null}
                      </td>
                      <td>
                        {ACTIVE_MO.includes(m.status) && m.status !== 'READY_FOR_PICKUP' ? (
                          <SlaCell due={due} breached={m.slaBreached} label={m.status === 'NEW' ? 'مهلة القبول' : 'مهلة التجهيز'} />
                        ) : m.deliveredAt ? (
                          <span className="cell-sub">سُلّم <DateTime iso={m.deliveredAt} /></span>
                        ) : m.handedOverAt ? (
                          <span className="cell-sub">سُلّم للناقل <DateTime iso={m.handedOverAt} /></span>
                        ) : m.readyAt ? (
                          <span className="cell-sub">جاهز <DateTime iso={m.readyAt} /></span>
                        ) : (
                          <span className="muted">—</span>
                        )}
                        {m.slaBreached ? <div><Chip tone="danger">تجاوز المهلة</Chip></div> : null}
                      </td>
                      <td className="end"><Money h={m.itemsHalalas} /></td>
                      <td className="end"><Money h={m.shippingHalalas} /></td>
                      <td className="end">
                        <Money h={m.commissionHalalas} />
                        <div className="cell-sub num">{(m.commissionBps / 100).toFixed(2)}%</div>
                      </td>
                      <td>
                        <MerchantOrderActions id={m.id} number={m.number} status={m.status} onDone={reload} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="الأصناف" id="items" flush>
          <div className="table-wrap">
            <table className="t">
              <thead>
                <tr>
                  <th>المنتج</th>
                  <th>رقم القطعة</th>
                  <th>الحالة</th>
                  <th>الطلب الفرعي</th>
                  <th className="end">الكمية</th>
                  <th className="end">سعر الوحدة</th>
                  <th className="end">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {o.items.map((i) => (
                  <tr key={i.id}>
                    <td>
                      {i.productNameAr}
                      {i.status === 'CANCELLED' ? <> <Chip>ملغي</Chip></> : null}
                    </td>
                    <td><Mono>{i.partNumber}</Mono></td>
                    <td>{{ NEW: 'جديد', USED: 'مستعمل', REFURBISHED: 'مجدد' }[i.condition] ?? i.condition}</td>
                    <td className="num">{moNumber[i.merchantOrderId]}</td>
                    <td className="end num">{i.quantity}</td>
                    <td className="end"><Money h={i.unitPriceHalalas} /></td>
                    <td className="end"><Money h={i.lineTotalHalalas} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card title="مجموعات الشحن والشحنات" id="shipping">
          {o.groups.length ? (
            <div className="stack">
              {o.groups.map((g) => {
                const ships = outboundByGroup(g.id);
                return (
                  <div key={g.id} className="posting">
                    <div className="posting-head">
                      <span>
                        <strong>مجموعة {shortId(g.id)}</strong> · {moNumber[g.merchantOrderId]} · من {ships[0]?.originLocation ? `${ships[0].originLocation.name} (${cityName(ships[0].originLocation.city)})` : '—'} إلى {cityName(addr.city)}
                      </span>
                      <span className="muted">
                        {SERVICE_LABEL[g.serviceCode] ?? g.serviceCode} · {g.carrierCode} · <Money h={g.quotedHalalas} /> · {formatWeight(g.weightGrams)} · {g.etaDaysMin}–{g.etaDaysMax} يوم
                      </span>
                    </div>
                    <div style={{ padding: 12 }} className="stack">
                      {ships.length ? ships.map((s) => <ShipmentBlock key={s.id} s={s} reload={reload} />) : <p className="muted">لم تُنشأ شحنة بعد — تُنشأ عندما يعلّم التاجر الطلب كجاهز.</p>}
                    </div>
                  </div>
                );
              })}
              {[...ungroupedOutbound, ...returnShipments].map((s) => (
                <div key={s.id} className="posting">
                  <div className="posting-head">
                    <strong>{DIRECTION_LABEL[s.direction]} · {moNumber[s.merchantOrderId]}</strong>
                  </div>
                  <div style={{ padding: 12 }}>
                    <ShipmentBlock s={s} reload={reload} />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>لا توجد مجموعات شحن</Empty>
          )}
        </Card>

        <Card title="المدفوعات وسجل webhooks" id="payments">
          {o.payments.length ? (
            <div className="stack">
              {o.payments.map((p) => (
                <div key={p.id} className="posting">
                  <div className="posting-head">
                    <span className="row gap-sm wrap">
                      <StatusChip kind="payment" value={p.status} />
                      <span>{PAYMENT_METHOD_LABEL[p.method] ?? p.method}</span>
                      <span className="muted">{p.provider}</span>
                      <Mono>{p.providerPaymentId}</Mono>
                      {p.sandbox ? <SandboxTag>تجريبي</SandboxTag> : null}
                    </span>
                    <span className="row gap-sm wrap">
                      المبلغ <Money h={p.amountHalalas} /> · المحصّل <Money h={p.capturedHalalas} /> · المسترد <Money h={p.refundedHalalas} />
                    </span>
                  </div>
                  {p.failureReason ? <div className="alert alert-danger" style={{ margin: 8 }}>{p.failureReason}</div> : null}
                  {p.events.length ? (
                    <table className="t">
                      <thead>
                        <tr>
                          <th>الوقت</th>
                          <th>النوع</th>
                          <th>النتيجة</th>
                          <th>معرّف الحدث</th>
                          <th>الحمولة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.events.map((e) => (
                          <tr key={e.id}>
                            <td><DateTime iso={e.createdAt} /></td>
                            <td><Mono>{e.type}</Mono></td>
                            <td><Chip tone={webhookOutcomeTone(e.outcome)}>{e.outcome}</Chip></td>
                            <td><Mono>{e.providerEventId}</Mono></td>
                            <td><JsonDetails value={e.payload} summary="عرض" /></td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <p className="muted" style={{ padding: 10 }}>لم تصل أحداث webhook</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Empty>لا توجد مدفوعات</Empty>
          )}
        </Card>

        <Card title="الاستردادات" id="refunds" flush actions={canRefund ? <button className="btn btn-sm" onClick={() => setRefundOpen(true)}>استرداد جزئي / تعويض</button> : null}>
          {o.refunds.length ? (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>التاريخ</th>
                    <th>الحالة</th>
                    <th className="end">المبلغ</th>
                    <th>السبب</th>
                    <th>التوزيع</th>
                    <th>مرجع المزود</th>
                  </tr>
                </thead>
                <tbody>
                  {o.refunds.map((rf) => (
                    <tr key={rf.id}>
                      <td><DateTime iso={rf.createdAt} /></td>
                      <td>
                        <StatusChip kind="refund" value={rf.status} />
                        {rf.failureReason ? <div className="cell-sub">{rf.failureReason}</div> : null}
                      </td>
                      <td className="end"><Money h={rf.amountHalalas} /></td>
                      <td>{rf.reason}</td>
                      <td className="small">
                        {(rf.allocation ?? []).map((a, i) => (
                          <div key={i}>
                            {moNumber[a.merchantOrderId] ?? shortId(a.merchantOrderId)}: أصناف <Money h={a.items} /> · شحن <Money h={a.shipping} /> · عمولة <Money h={a.commission} />
                          </div>
                        ))}
                      </td>
                      <td><Mono>{rf.providerRefundId ?? '—'}</Mono></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>لا توجد استردادات</Empty>
          )}
        </Card>

        <Card title="المرتجعات" id="returns" flush>
          {o.returnCases.length ? (
            <div className="table-wrap">
              <table className="t">
                <thead>
                  <tr>
                    <th>الرقم</th>
                    <th>الحالة</th>
                    <th>السبب</th>
                    <th>الأصناف</th>
                    <th className="end">مبلغ الاسترداد</th>
                    <th>التاريخ</th>
                  </tr>
                </thead>
                <tbody>
                  {o.returnCases.map((rc) => (
                    <tr key={rc.id}>
                      <td><Link href={`/returns?focus=${rc.id}`} className="num">{rc.number}</Link></td>
                      <td><StatusChip kind="return" value={rc.status} /></td>
                      <td>
                        {RETURN_REASON_LABEL[rc.reason] ?? rc.reason}
                        {rc.customerNote ? <div className="cell-sub">{rc.customerNote}</div> : null}
                      </td>
                      <td className="small">
                        {rc.items.map((it) => (
                          <div key={it.orderItemId}>
                            {o.items.find((x) => x.id === it.orderItemId)?.productNameAr ?? shortId(it.orderItemId)} × {it.quantity}
                          </div>
                        ))}
                      </td>
                      <td className="end"><Money h={rc.refundHalalas} /></td>
                      <td><DateTime iso={rc.createdAt} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty>لا توجد مرتجعات</Empty>
          )}
        </Card>

        <Card title="القيود المحاسبية (دفتر الأستاذ)" id="ledger" actions={<span className="muted small">موجب = مدين · سالب = دائن · كل قيد متوازن (المجموع صفر)</span>}>
          {postings.length ? (
            <div data-testid="ledger">
              {postings.map((lines) => {
                const head = lines[0];
                const sum = lines.reduce((a, l) => a + l.amountHalalas, 0);
                return (
                  <div key={head.postingId} className="posting">
                    <div className="posting-head">
                      <span>
                        <strong>{POSTING_LABEL[head.postingType] ?? head.postingType}</strong> · {head.refType} <Mono>{shortId(head.refId)}</Mono>
                      </span>
                      <span className="row gap-sm">
                        <DateTime iso={head.createdAt} />
                        <Chip tone={sum === 0 ? 'success' : 'danger'}>{sum === 0 ? 'متوازن' : `غير متوازن ${sum}`}</Chip>
                      </span>
                    </div>
                    <table className="t">
                      <thead>
                        <tr>
                          <th>الحساب</th>
                          <th>الطلب الفرعي</th>
                          <th className="end">مدين</th>
                          <th className="end">دائن</th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.id}>
                            <td>
                              {ACCOUNT_LABEL[l.account] ?? l.account} <span className="cell-sub mono">{l.account}</span>
                            </td>
                            <td className="num">{l.merchantOrderId ? moNumber[l.merchantOrderId] ?? shortId(l.merchantOrderId) : '—'}</td>
                            <td className="end">{l.amountHalalas > 0 ? <Money h={l.amountHalalas} /> : ''}</td>
                            <td className="end">{l.amountHalalas < 0 ? <Money h={-l.amountHalalas} /> : ''}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>
          ) : (
            <Empty>لا توجد قيود (لم يُحصّل الدفع بعد)</Empty>
          )}
        </Card>

        <Card title="المطابقة المالية" id="reconciliation">
          {r.reconciled ? (
            <div className="recon-ok" data-testid="reconciled" data-reconciled="true">
              <span aria-hidden>✓</span> مطابق
              <span className="small" style={{ fontWeight: 500 }}>الطلب والمدفوعات والاستردادات ودفتر الأستاذ متطابقة</span>
            </div>
          ) : (
            <div className="recon-bad" data-testid="reconciled" data-reconciled="false">
              <strong>غير مطابق — {r.issues.length} مشكلة</strong>
              <ul>
                {r.issues.map((i) => (
                  <li key={i} dir="ltr" style={{ textAlign: 'start' }}>
                    {i}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div style={{ marginBlockStart: 12 }}>
            <KV
              items={[
                ['المحصّل', <Money key="c" h={r.capturedHalalas} />],
                ['المسترد (ناجح)', <Money key="r" h={r.refundedHalalas} />],
                ['صافي المحصّل', <Money key="n" h={r.netCollectedHalalas} />],
                ['رسوم مزود الدفع' + (r.paymentFeesEstimated ? ' (تقديرية)' : ''), <Money key="f" h={r.paymentFeesHalalas ?? 0} />],
                ['هامش المساهمة', <Money key="m" h={r.margin?.contributionHalalas ?? 0} />],
                ...Object.entries(r.ledger).map(([acct, v]) => [ACCOUNT_LABEL[acct] ?? acct, <Money key={acct} h={v} />] as [string, React.ReactNode]),
              ]}
            />
          </div>
        </Card>

        <Card title="سجل التدقيق" id="audit">
          {auditTrail.length ? (
            <ol className="timeline">
              {auditTrail.map((a) => (
                <li key={a.id} className={a.actorType === 'ops' ? 't-info' : a.action.includes('reject') || a.action.includes('fail') ? 't-danger' : ''}>
                  <div className="tl-head">
                    <strong>{auditLabel(a.action)}</strong>
                    <span className="tl-meta num">
                      <DateTime iso={a.createdAt} />
                    </span>
                    <Chip>{ACTOR_LABEL[a.actorType] ?? a.actorType}</Chip>
                  </div>
                  <div className="tl-meta">
                    {ENTITY_LABEL[a.entityType] ?? a.entityType} {moNumber[a.entityId] ?? <Mono>{shortId(a.entityId)}</Mono>}
                    {a.actorUserId ? <> · المستخدم <Mono>{shortId(a.actorUserId)}</Mono></> : null} <span className="mono small">{a.action}</span>
                  </div>
                  {a.data ? <JsonDetails value={a.data} /> : null}
                </li>
              ))}
            </ol>
          ) : (
            <Empty>لا توجد أحداث تدقيق</Empty>
          )}
        </Card>
      </div>

      {canRefund ? <RefundDialog open={refundOpen} onClose={() => setRefundOpen(false)} order={o} onDone={reload} /> : null}
    </>
  );
}

function ShipmentBlock({ s, reload }: { s: OrderTrace['order']['shipments'][number]; reload: () => void }) {
  return (
    <div className="grid grid-2" style={{ gap: 12 }}>
      <div className="stack-sm">
        <div className="row gap-sm wrap">
          <StatusChip kind="shipment" value={s.status} />
          <Chip tone={s.direction === 'RETURN' ? 'warning' : 'neutral'}>{DIRECTION_LABEL[s.direction]}</Chip>
          {s.trackingNumber ? <Mono>{s.trackingNumber}</Mono> : <span className="muted small">بدون بوليصة</span>}
          <Link href={`/tower/shipments/${s.id}`} className="small">
            تفاصيل الشحنة
          </Link>
        </div>
        {s.exceptionReason ? <div className="alert alert-danger">{s.exceptionReason}</div> : null}
        {s.pickupWindowStart ? (
          <div className="small muted">
            نافذة الاستلام: <DateTime iso={s.pickupWindowStart} /> – <DateTime iso={s.pickupWindowEnd} />
          </div>
        ) : null}
        <ShipmentActions shipment={s} onDone={reload} compact />
      </div>
      <div>
        <ShipmentTimeline events={s.events} />
      </div>
    </div>
  );
}

