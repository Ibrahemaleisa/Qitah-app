'use client';

import Link from 'next/link';
import { useState } from 'react';

import { RequireRole } from '@/components/AppShell';
import { useSession } from '@/components/Session';
import { Async, Card, Chip, ConfirmButton, DateTime, Dialog, Empty, Field, JsonDetails, Money, Mono, PageHead, SandboxTag, StatusChip } from '@/components/ui';
import { post } from '@/lib/api';
import { addDays, riyadhDate, riyadhToIso } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { CADENCE_LABEL, webhookOutcomeTone } from '@/lib/labels';
import { formatSar } from '@/lib/money';
import type { Eligibility, Margins, PaymentEvent, Settlement } from '@/lib/types';

type RunResult = { reservesReleased: number; settlementsDrafted: number; staleReminders: number; qualityScoresUpdated: number };

export function FinanceView() {
  return (
    <RequireRole role="FINANCE">
      <Finance />
    </RequireRole>
  );
}

function Finance() {
  const { sandbox } = useSession();
  const settlements = useApi<{ settlements: Settlement[]; eligibility: Eligibility[] }>('v1/ops/settlements', { live: (e) => e.type.startsWith('refund.') || e.entityType === 'merchant_order' });
  const events = useApi<{ events: PaymentEvent[] }>('v1/ops/payments/events', { live: (e) => e.type.startsWith('refund.') || e.type.startsWith('order.') || e.type.startsWith('payment.') });
  const { run, pending } = useAction();
  const [gen, setGen] = useState<Eligibility | null>(null);
  const [simulate, setSimulate] = useState(false);
  const [asOf, setAsOf] = useState(() => addDays(riyadhDate(), 8));
  const [paid, setPaid] = useState<Settlement | null>(null);
  const [ref, setRef] = useState('');
  const margins = useApi<Margins>('v1/ops/finance/margins?limit=50', { live: (e) => e.type === 'order.paid' || e.type.startsWith('refund.') });
  const [runOpen, setRunOpen] = useState(false);
  const [runSimulate, setRunSimulate] = useState(false);
  const [runAsOf, setRunAsOf] = useState(() => addDays(riyadhDate(), 8));

  async function runJobs() {
    const body: { asOf?: string } = {};
    if (sandbox && runSimulate) body.asOf = riyadhToIso(runAsOf, '23:59');
    const r = await run('run', () => post<RunResult>('v1/ops/settlements/run', body), (x) => `مسودات جديدة: ${x.settlementsDrafted} · محجوز أُفرج عنه: ${x.reservesReleased}`);
    if (r) {
      setRunOpen(false);
      settlements.reload();
    }
  }

  function openRun() {
    setRunSimulate(false);
    setRunOpen(true);
  }

  const reloadAll = () => {
    settlements.reload();
    events.reload();
  };

  async function generate() {
    if (!gen) return;
    const body: { merchantId: string; asOf?: string } = { merchantId: gen.merchantId };
    if (sandbox && simulate) body.asOf = riyadhToIso(asOf, '23:59');
    const r = await run('generate', () => post<Settlement>('v1/ops/settlements/generate', body), (s) => `أُنشئت تسوية بصافي ${formatSar(s.netHalalas)}`);
    if (r) {
      setGen(null);
      settlements.reload();
    }
  }

  async function markPaid() {
    if (!paid || ref.trim().length < 3) return;
    const r = await run('paid', () => post(`v1/ops/settlements/${paid.id}/paid`, { payoutReference: ref.trim() }), 'سُجّل التحويل');
    if (r) {
      setPaid(null);
      settlements.reload();
    }
  }

  return (
    <>
      <PageHead
        title="المالية"
        sub="تسويات التجار، سجل webhooks الدفع، والاستردادات"
        actions={
          <>
            <button className="btn" onClick={openRun} data-testid="run-settlements">
              تشغيل التسوية التلقائية الآن
            </button>
            {sandbox ? (
              <ConfirmButton
                size="md"
                tone="default"
                sandbox
                label="تسوية استردادات البيئة التجريبية"
                title="تسوية الاستردادات المعلّقة (محاكاة)"
                message="يرسل مزود الدفع التجريبي webhook «refund.succeeded» موقّعاً لكل استرداد مُرسَل ومعلّق، عبر مسار webhook الحقيقي. (العامل الخلفي يفعل ذلك تلقائياً عادةً.)"
                confirmLabel="تسوية الآن"
                testId="settle-sandbox-refunds"
                onConfirm={() => run('settle', () => post<{ settled: number }>('v1/ops/sandbox/refunds/settle'), (r) => `سُوّي ${r.settled} استرداد`).then(reloadAll)}
              />
            ) : null}
          </>
        }
      />
      <div className="notice" style={{ marginBlockEnd: 16 }}>
        التحويلات البنكية للتجار تتم خارج منصة قطعة (عبر البنك). ينشئ العامل الخلفي مسودات التسوية تلقائياً (أسبوعياً، أو يومياً للتجار المفعّل لهم ذلك)، وتُعتمد هنا، ثم يُسجَّل مرجع التحويل البنكي بعد تنفيذه. التجار الموثوقون بالتسوية اليومية يُصرف لهم بعد التوصيل مع حجز نسبة حتى انتهاء نافذة الإرجاع.
      </div>
      <div className="stack">
        <Card title="أهلية التسوية لكل تاجر" flush>
          <Async state={settlements}>
            {(d) => (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>التاجر</th>
                      <th>الدورة</th>
                      <th className="end">طلبات مؤهلة</th>
                      <th className="end">الصافي المؤهل</th>
                      <th className="end">محجوز (احتياطي)</th>
                      <th className="end">المستحق (الدفتر)</th>
                      <th className="end">العمولة</th>
                      <th className="end">المحوّل</th>
                      <th>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.eligibility.map((e) => (
                      <tr key={e.merchantId}>
                        <td>
                          <Link href={`/merchants/${e.merchantId}`}>{e.displayNameAr}</Link>
                        </td>
                        <td className="small">
                          {e.settlementCadence ? CADENCE_LABEL[e.settlementCadence] : '—'}
                          {e.trustedForEarlyPayout ? <div className="cell-sub">صرف مبكر</div> : null}
                        </td>
                        <td className="end num">{e.eligibleOrders}</td>
                        <td className="end">
                          <Money h={e.eligibleNetHalalas} />
                          {e.eligibleReserveHalalas ? (
                            <div className="cell-sub">
                              يُحجز <Money h={e.eligibleReserveHalalas} />
                            </div>
                          ) : null}
                        </td>
                        <td className="end">
                          <Money h={e.balance.reserveHeldHalalas ?? 0} />
                        </td>
                        <td className="end">
                          <Money h={e.balance.payableHalalas} />
                        </td>
                        <td className="end">
                          <Money h={e.balance.commissionHalalas} />
                        </td>
                        <td className="end">
                          <Money h={e.balance.paidOutHalalas} />
                        </td>
                        <td>
                          <button className="btn btn-sm" onClick={() => (setSimulate(false), setGen(e))} disabled={!e.eligibleOrders && !sandbox}>
                            إنشاء تسوية
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Async>
        </Card>

        <Card title="التسويات" flush>
          <Async state={settlements}>
            {(d) =>
              d.settlements.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>التاجر</th>
                        <th>الحالة</th>
                        <th className="end">الإجمالي</th>
                        <th className="end">العمولة</th>
                        <th className="end">الاستردادات</th>
                        <th className="end">الصافي</th>
                        <th className="end">الطلبات</th>
                        <th>التواريخ</th>
                        <th>مرجع التحويل</th>
                        <th>الإجراء</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.settlements.map((s) => (
                        <tr key={s.id}>
                          <td>
                            {s.merchant.displayNameAr}
                            {s.automatic ? <div className="cell-sub">تلقائية</div> : null}
                          </td>
                          <td>
                            <StatusChip kind="settlement" value={s.status} />
                          </td>
                          <td className="end">
                            <Money h={s.grossHalalas} />
                          </td>
                          <td className="end">
                            <Money h={s.commissionHalalas} />
                          </td>
                          <td className="end">
                            <Money h={s.refundsHalalas} />
                            {s.reserveHeldHalalas ? (
                              <div className="cell-sub">
                                محجوز <Money h={s.reserveHeldHalalas} />
                              </div>
                            ) : null}
                            {s.reserveReleasedHalalas ? (
                              <div className="cell-sub">
                                إفراج <Money h={s.reserveReleasedHalalas} />
                              </div>
                            ) : null}
                          </td>
                          <td className="end">
                            <strong>
                              <Money h={s.netHalalas} />
                            </strong>
                          </td>
                          <td className="end num">{s.lines.length}</td>
                          <td className="small">
                            <div>
                              أُنشئت <DateTime iso={s.createdAt} />
                            </div>
                            {s.approvedAt ? (
                              <div>
                                اعتُمدت <DateTime iso={s.approvedAt} />
                              </div>
                            ) : null}
                            {s.paidAt ? (
                              <div>
                                حُوّلت <DateTime iso={s.paidAt} />
                              </div>
                            ) : null}
                          </td>
                          <td>{s.payoutReference ? <Mono>{s.payoutReference}</Mono> : <span className="muted">—</span>}</td>
                          <td>
                            {s.status === 'DRAFT' ? (
                              <ConfirmButton
                                label="اعتماد"
                                title="اعتماد التسوية"
                                message={`اعتماد تسوية ${s.merchant.displayNameAr} بصافي ${formatSar(s.netHalalas)}. بعد الاعتماد يُنفّذ التحويل البنكي خارج المنصة.`}
                                onConfirm={() => run('approve', () => post(`v1/ops/settlements/${s.id}/approve`), 'اعتُمدت التسوية').then(settlements.reload)}
                              />
                            ) : s.status === 'APPROVED' ? (
                              <button className="btn btn-sm btn-primary" onClick={() => (setRef(''), setPaid(s))}>
                                تسجيل التحويل
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <Empty>لا توجد تسويات بعد</Empty>
              )
            }
          </Async>
        </Card>

        <Card title="هامش المساهمة لكل طلب" id="margins" flush>
          <Async state={margins}>
            {(d) => (
              <>
                <div className="metrics" style={{ padding: 16 }} data-testid="margin-totals">
                  <div className="metric">
                    <span className="v num">{formatSar(d.totals.commissionHalalas)}</span>
                    <span className="l">العمولة (صافي)</span>
                  </div>
                  <div className="metric">
                    <span className="v num">{formatSar(d.totals.shippingMarginHalalas)}</span>
                    <span className="l">هامش الشحن</span>
                  </div>
                  <div className="metric warn-on">
                    <span className="v num">{formatSar(d.totals.paymentFeesHalalas)}</span>
                    <span className="l">رسوم الدفع</span>
                  </div>
                  <div className="metric warn-on">
                    <span className="v num">{formatSar(d.totals.guaranteeExpenseHalalas)}</span>
                    <span className="l">تكلفة ضمان قطعة</span>
                  </div>
                  <div className={`metric ${d.totals.contributionHalalas < 0 ? 'alert-on' : ''}`}>
                    <span className="v num">{formatSar(d.totals.contributionHalalas)}</span>
                    <span className="l">هامش المساهمة ({d.totals.orders} طلب)</span>
                  </div>
                  <div className={`metric ${d.totals.negativeOrders ? 'alert-on' : ''}`}>
                    <span className="v num">{d.totals.negativeOrders}</span>
                    <span className="l">طلبات بهامش سالب</span>
                  </div>
                </div>
                <p className="muted small" style={{ padding: '0 16px 8px' }}>
                  الهامش = العمولة بعد الاستردادات + هامش الشحن (المدفوع − المسترد − تكلفة البوليصة) − رسوم مزود الدفع − تكلفة ضمان قطعة. رسوم البيئة التجريبية تقديرية من جدول الرسوم (مدى 0.8%، بطاقة 2%، Apple Pay 2%، STC Pay 1.5%).
                </p>
                <div className="table-wrap">
                  <table className="t" data-testid="margins-table">
                    <thead>
                      <tr>
                        <th>الطلب</th>
                        <th>الدفع</th>
                        <th className="end">الإجمالي</th>
                        <th className="end">العمولة</th>
                        <th className="end">هامش الشحن</th>
                        <th className="end">رسوم الدفع</th>
                        <th className="end">الضمان</th>
                        <th className="end">الهامش</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.items.map((o) => (
                        <tr key={o.orderId}>
                          <td>
                            <Link href={`/orders/${o.orderId}`}>
                              <Mono>{o.number}</Mono>
                            </Link>
                            <div className="cell-sub">
                              <DateTime iso={o.paidAt} />
                            </div>
                          </td>
                          <td className="small">
                            {o.paymentMethod}
                            {o.feesEstimated ? <div className="cell-sub">رسوم تقديرية</div> : null}
                          </td>
                          <td className="end">
                            <Money h={o.totalHalalas} />
                            {o.refundedHalalas ? (
                              <div className="cell-sub">
                                مسترد <Money h={o.refundedHalalas} />
                              </div>
                            ) : null}
                          </td>
                          <td className="end">
                            <Money h={o.commissionHalalas} />
                          </td>
                          <td className="end">
                            <Money h={o.shippingMarginHalalas} />
                          </td>
                          <td className="end">
                            <Money h={-o.paymentFeesHalalas} />
                          </td>
                          <td className="end">
                            <Money h={-o.guaranteeExpenseHalalas} />
                          </td>
                          <td className="end">
                            <strong>
                              <Money h={o.contributionHalalas} />
                            </strong>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </Async>
        </Card>

        <Card title="سجل webhooks الدفع" id="payments" flush>
          <Async state={events}>
            {(d) =>
              d.events.length ? (
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>الوقت</th>
                        <th>المزود</th>
                        <th>النوع</th>
                        <th>النتيجة</th>
                        <th>معرّف الحدث</th>
                        <th>الدفعة</th>
                        <th>الحمولة</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.events.map((e) => (
                        <tr key={e.id}>
                          <td>
                            <DateTime iso={e.createdAt} />
                          </td>
                          <td>{e.provider}</td>
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
                            <Mono>{e.paymentId ? `…${e.paymentId.slice(-6)}` : '—'}</Mono>
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
                <Empty>لا توجد أحداث</Empty>
              )
            }
          </Async>
        </Card>
      </div>

      <Dialog open={!!gen} onClose={() => setGen(null)} title={`إنشاء تسوية — ${gen?.displayNameAr ?? ''}`} submitLabel="إنشاء التسوية" pending={pending === 'generate'} onSubmit={generate}>
        <p>
          تشمل الطلبات المسلّمة التي انقضت نافذة إرجاعها، بلا مرتجع مفتوح أو استرداد معلّق، ولم تُسوَّ بعد. المبالغ من دفتر الأستاذ. المؤهل الآن: <Money h={gen?.eligibleNetHalalas ?? 0} /> ({gen?.eligibleOrders ?? 0} طلب).
        </p>
        {sandbox ? (
          <div className="col gap-sm" style={{ border: '1px dashed #d9a63b', borderRadius: 8, padding: 10, background: '#fffaf0' }}>
            <div className="row gap-sm">
              <SandboxTag />
            </div>
            <label className="check">
              <input type="checkbox" checked={simulate} onChange={(e) => setSimulate(e.target.checked)} data-testid="simulate-asof" /> محاكاة انقضاء نافذة الإرجاع (حساب الأهلية كما لو كان التاريخ)
            </label>
            {simulate ? (
              <Field label="التاريخ المفترض (asOf)">
                <input type="date" value={asOf} min={riyadhDate()} onChange={(e) => setAsOf(e.target.value)} />
              </Field>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog open={runOpen} onClose={() => setRunOpen(false)} title="تشغيل التسوية التلقائية الآن" submitLabel="تشغيل" pending={pending === 'run'} onSubmit={runJobs}>
        <p>
          يُفرج عن المبالغ المحجوزة التي انقضت نافذة إرجاعها، ثم يُنشئ مسودة تسوية لكل تاجر حلّ موعد دورته ولديه طلبات مؤهلة. الدورة التي سبق تشغيلها لا تتكرر. الاعتماد والتحويل يبقيان يدويين.
        </p>
        {sandbox ? (
          <div className="col gap-sm" style={{ border: '1px dashed #d9a63b', borderRadius: 8, padding: 10, background: '#fffaf0' }}>
            <div className="row gap-sm">
              <SandboxTag />
            </div>
            <label className="check">
              <input type="checkbox" checked={runSimulate} onChange={(e) => setRunSimulate(e.target.checked)} /> محاكاة تاريخ لاحق
            </label>
            {runSimulate ? (
              <Field label="التاريخ المفترض (asOf)">
                <input type="date" value={runAsOf} min={riyadhDate()} onChange={(e) => setRunAsOf(e.target.value)} />
              </Field>
            ) : null}
          </div>
        ) : null}
      </Dialog>

      <Dialog open={!!paid} onClose={() => setPaid(null)} title="تسجيل تحويل بنكي منفّذ" submitLabel="تسجيل كمدفوعة" pending={pending === 'paid'} onSubmit={markPaid}>
        <p>
          سجّل مرجع التحويل البنكي بعد تنفيذه خارج قطعة. صافي التسوية: <Money h={paid?.netHalalas ?? 0} /> إلى {paid?.merchant.displayNameAr}.
        </p>
        <Field label="مرجع التحويل البنكي">
          <input required minLength={3} maxLength={100} dir="ltr" value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
      </Dialog>
    </>
  );
}
