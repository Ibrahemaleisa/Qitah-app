'use client';

import Link from 'next/link';

import { MerchantOrderActions, ShipmentActions, SlaCell } from '@/components/ops';
import { TowerNav } from '@/components/TowerNav';
import { Async, Card, Chip, DateTime, Empty, JsonDetails, Money, Mono, PageHead, StatusChip } from '@/components/ui';
import { useApi } from '@/lib/hooks';
import { webhookOutcomeTone } from '@/lib/labels';
import type { Exceptions } from '@/lib/types';

export function ExceptionsView() {
  const state = useApi<Exceptions>('v1/ops/exceptions', { live: () => true });
  return (
    <>
      <PageHead title="الاستثناءات" sub="كل ما يحتاج تدخلاً الآن: الشحن، مهلات التجار، الاستردادات، وتنبيهات الدفع" />
      <TowerNav />
      <Async state={state} rows={8}>
        {(d) => (
          <div className="stack">
            <Card title={<>شحنات متعثرة <span className={`count ${d.shipments.length ? 'count-danger' : ''}`}>{d.shipments.length}</span></>} id="shipments" flush>
              {d.shipments.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>الطلب الفرعي</th>
                        <th>التاجر</th>
                        <th>الحالة</th>
                        <th>السبب</th>
                        <th>آخر تحديث</th>
                        <th>الإجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.shipments.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <Link href={`/tower/shipments/${s.id}`} className="num">
                              {s.merchantOrder.number}
                            </Link>
                            <div className="cell-sub">
                              <Link href={`/orders/${s.orderId}`}>{s.order.number}</Link>
                            </div>
                          </td>
                          <td>{s.merchantOrder.merchant.displayNameAr}</td>
                          <td>
                            <StatusChip kind="shipment" value={s.status} />
                          </td>
                          <td>{s.exceptionReason ?? '—'}</td>
                          <td>
                            <DateTime iso={s.updatedAt} ago />
                          </td>
                          <td>
                            <ShipmentActions shipment={s} onDone={state.reload} compact />
                            <Link href={`/tower/shipments/${s.id}`} className="small">
                              تسجيل حدث / التفاصيل
                            </Link>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لا توجد شحنات متعثرة</Empty>
              )}
            </Card>

            <Card title={<>تأخر استلام الناقل (انقضت النافذة) <span className={`count ${d.delayedPickups.length ? 'count-warning' : ''}`}>{d.delayedPickups.length}</span></>} id="delayed" flush>
              {d.delayedPickups.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>الطلب الفرعي</th>
                        <th>التاجر</th>
                        <th>نافذة الاستلام</th>
                        <th>رقم التتبع</th>
                        <th>الإجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.delayedPickups.map((s) => (
                        <tr key={s.id}>
                          <td>
                            <Link href={`/tower/shipments/${s.id}`} className="num">
                              {s.merchantOrder.number}
                            </Link>
                          </td>
                          <td>{s.merchantOrder.merchant.displayNameAr}</td>
                          <td className="sla-breach">
                            <DateTime iso={s.pickupWindowStart} /> – <DateTime iso={s.pickupWindowEnd} />
                          </td>
                          <td>
                            <Mono>{s.trackingNumber}</Mono>
                          </td>
                          <td>
                            <ShipmentActions shipment={s} onDone={state.reload} compact preface="PICKUP_FAILED" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لا توجد استلامات متأخرة</Empty>
              )}
            </Card>

            <Card title={<>تجاوز مهلة التاجر <span className={`count ${d.slaBreaches.length ? 'count-danger' : ''}`}>{d.slaBreaches.length}</span></>} id="sla" flush>
              <p className="notice" style={{ margin: 12 }}>
                يُعلَّم التجاوز بواسطة مهمة المراقبة في عامل الخلفية (worker). تواصل مع التاجر، أو نفّذ الخطوة نيابةً عنه بعد تأكيده.
              </p>
              {d.slaBreaches.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>الطلب الفرعي</th>
                        <th>التاجر</th>
                        <th>الحالة</th>
                        <th>المهلة</th>
                        <th>الإجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.slaBreaches.map((m) => (
                        <tr key={m.id}>
                          <td>
                            <Link href={`/orders/${m.orderId}`} className="num">
                              {m.number}
                            </Link>
                          </td>
                          <td>{m.merchant.displayNameAr}</td>
                          <td>
                            <StatusChip kind="merchantOrder" value={m.status} />
                          </td>
                          <td>
                            <SlaCell due={m.status === 'NEW' ? m.acceptBy : m.readyBy} breached />
                          </td>
                          <td>
                            <MerchantOrderActions id={m.id} number={m.number} status={m.status} onDone={state.reload} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لا توجد تجاوزات</Empty>
              )}
            </Card>

            <Card title={<>استردادات فاشلة <span className={`count ${d.failedRefunds.length ? 'count-danger' : ''}`}>{d.failedRefunds.length}</span></>} id="refunds" flush>
              {d.failedRefunds.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>الطلب</th>
                        <th className="end">المبلغ</th>
                        <th>السبب</th>
                        <th>سبب الفشل</th>
                        <th>التاريخ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.failedRefunds.map((r) => (
                        <tr key={r.id}>
                          <td>
                            <Link href={`/orders/${r.orderId}#refunds`} className="num">
                              {r.order.number}
                            </Link>
                          </td>
                          <td className="end">
                            <Money h={r.amountHalalas} />
                          </td>
                          <td>{r.reason}</td>
                          <td className="sla-breach">{r.failureReason ?? '—'}</td>
                          <td>
                            <DateTime iso={r.createdAt} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لا توجد استردادات فاشلة</Empty>
              )}
            </Card>

            <Card title={<>أحداث دفع مُعلَّمة <span className={`count ${d.flaggedPayments.length ? 'count-danger' : ''}`}>{d.flaggedPayments.length}</span></>} id="payments" flush>
              {d.flaggedPayments.length ? (
                <div className="table-wrap">
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
                      {d.flaggedPayments.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <DateTime iso={e.createdAt} />
                          </td>
                          <td>
                            <Mono>{e.type}</Mono>
                          </td>
                          <td>
                            <Chip tone={webhookOutcomeTone(e.outcome)}>{e.outcome}</Chip>
                          </td>
                          <td>
                            <Mono>{e.providerEventId}</Mono>
                          </td>
                          <td>
                            <JsonDetails value={e.payload} summary="عرض" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لا توجد أحداث مُعلَّمة</Empty>
              )}
            </Card>
          </div>
        )}
      </Async>
    </>
  );
}
