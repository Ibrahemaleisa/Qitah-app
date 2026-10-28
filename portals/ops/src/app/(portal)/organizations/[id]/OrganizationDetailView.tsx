'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { type OrgCredit, type OrgRow } from '@/components/OrgNav';
import { useSession } from '@/components/Session';
import { Async, Card, Chip, ConfirmButton, DateTime, Dialog, Empty, Field, KV, Money, PageHead, SandboxTag, StatusChip } from '@/components/ui';
import { api, newIdempotencyKey, post } from '@/lib/api';
import { cityName } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { formatSar, parseSarToHalalas } from '@/lib/money';

type Statement = {
  org: OrgRow;
  credit: OrgCredit & { usedHalalas: number; overdueHalalas: number; nextDueAt: string | null };
  creditLine: { limitHalalas: number; termsDays: number; status: 'ACTIVE' | 'FROZEN'; provider: string; updatedAt: string } | null;
  totals: { orders: number; spendHalalas: number };
  orders: {
    id: string;
    number: string;
    status: string;
    createdAt: string;
    paymentMethod: string;
    totalHalalas: number;
    workOrderRef: string | null;
    workshopQuoteId: string | null;
    buyerName: string | null;
    creditDueAt: string | null;
    outstandingHalalas: number;
    overdue: boolean;
  }[];
  repayments: { id: string; amountHalalas: number; reference: string | null; note: string | null; createdAt: string }[];
  members: { id: string; role: string; status: string; name: string | null; phone: string | null; joinedAt: string | null }[];
  activity: { id: string; action: string; actorType: string; createdAt: string }[];
};

type Decision = 'reject' | 'suspend';
const ROLE: Record<string, string> = { OWNER: 'المالك', BUYER: 'مشترٍ', TECHNICIAN: 'فني' };

export function OrganizationDetailView() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<Statement>(`v1/ops/organizations/${id}`, { live: (e) => e.entityType === 'organization' && e.entityId === id });
  const { isAdmin, has } = useSession();
  const canCredit = has('FINANCE') || isAdmin;
  const { run } = useAction();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [creditOpen, setCreditOpen] = useState(false);
  const [limit, setLimit] = useState('');
  const [terms, setTerms] = useState('30');
  const [repayOpen, setRepayOpen] = useState(false);
  const [repayKey, setRepayKey] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function decide() {
    if (!decision) return;
    if (reason.trim().length < 2) return setError('اكتب السبب');
    setPending(true);
    const r = await run(decision, () => post(`v1/ops/organizations/${id}/${decision}`, { reason: reason.trim() }), decision === 'reject' ? 'تم رفض الطلب' : 'تم إيقاف الورشة');
    setPending(false);
    if (r) {
      setDecision(null);
      state.reload();
    }
  }

  async function saveCredit() {
    const h = parseSarToHalalas(limit);
    const t = Number(terms);
    if (h === null) return setError('أدخل حداً صحيحاً بالريال');
    if (!Number.isInteger(t) || t < 0 || t > 180) return setError('مدة السداد بين 0 و180 يوماً');
    setPending(true);
    const r = await run('credit', () => api(`v1/ops/organizations/${id}/credit`, { method: 'PUT', body: { limitHalalas: h, termsDays: t, status: 'ACTIVE' } }), `الحد الائتماني ${formatSar(h)}`);
    setPending(false);
    if (r) {
      setCreditOpen(false);
      state.reload();
    }
  }

  async function repay() {
    const h = parseSarToHalalas(amount);
    if (h === null || h <= 0) return setError('أدخل مبلغاً صحيحاً بالريال');
    if (state.data && h > state.data.credit.outstandingHalalas) return setError(`المستحق ${formatSar(state.data.credit.outstandingHalalas)} فقط`);
    setPending(true);
    const r = await run('repay', () => post(`v1/ops/organizations/${id}/repayments`, { amountHalalas: h, idempotencyKey: repayKey, ...(reference.trim() ? { reference: reference.trim() } : {}) }), `سُجّل سداد ${formatSar(h)}`);
    setPending(false);
    if (r) {
      setRepayOpen(false);
      state.reload();
    }
  }

  return (
    <Async state={state} rows={6}>
      {(d) => {
        const o = d.org;
        const frozen = d.creditLine?.status === 'FROZEN';
        return (
          <>
            <PageHead
              crumbs={[{ href: '/organizations', label: 'الورش' }]}
              title={
                <span className="row gap-sm wrap">
                  {o.displayName} <StatusChip kind="organization" value={o.status} />
                  {d.creditLine ? <StatusChip kind="credit" value={d.creditLine.status} /> : null}
                </span>
              }
              sub={`${o.legalName} · ${o.type === 'FLEET' ? 'أسطول' : 'ورشة'}`}
              actions={
                <>
                  {isAdmin && o.status === 'APPLIED' ? (
                    <>
                      <ConfirmButton size="md" label="اعتماد" title="اعتماد الورشة" message={`سيتمكن أعضاء ${o.displayName} من الطلب باسم الورشة.`} onConfirm={() => run('approve', () => post(`v1/ops/organizations/${id}/approve`), 'تم اعتماد الورشة').then(state.reload)} testId="approve-org" />
                      <button className="btn btn-danger" onClick={() => (setReason(''), setError(null), setDecision('reject'))}>
                        رفض
                      </button>
                    </>
                  ) : null}
                  {isAdmin && o.status === 'APPROVED' ? (
                    <button className="btn btn-danger" onClick={() => (setReason(''), setError(null), setDecision('suspend'))}>
                      إيقاف مؤقت
                    </button>
                  ) : null}
                  {isAdmin && o.status === 'SUSPENDED' ? (
                    <ConfirmButton size="md" label="إعادة التفعيل" title="إعادة تفعيل الورشة" message="ستعود الورشة معتمدة." onConfirm={() => run('reinstate', () => post(`v1/ops/organizations/${id}/reinstate`), 'أُعيد التفعيل').then(state.reload)} />
                  ) : null}
                </>
              }
            />
            {o.statusReason ? <div className="alert alert-warning" style={{ marginBlockEnd: 16 }}>سبب الحالة: {o.statusReason}</div> : null}
            <div className="grid grid-main-side">
              <div className="stack">
                <Card title="بيانات المنشأة">
                  <KV
                    items={[
                      ['الاسم النظامي', o.legalName],
                      ['السجل التجاري', <span className="num" key="cr">{o.crNumber}</span>],
                      ['الرقم الضريبي', o.vatNumber ? <span className="num">{o.vatNumber}</span> : null],
                      ['المدينة', cityName(o.city)],
                      ['الحي / العنوان', `${o.district} · ${o.address}`],
                      ['الجوال', <bdi key="p" className="num">{o.contactPhone}</bdi>],
                      ['تاريخ الاعتماد', <DateTime key="a" iso={o.approvedAt} />],
                      ['تاريخ التسجيل', <DateTime key="c" iso={o.createdAt} />],
                    ]}
                  />
                </Card>
                <Card title={`طلبات الورشة (${d.totals.orders})`} flush>
                  {d.orders.length ? (
                    <div className="table-wrap">
                      <table className="t">
                        <thead>
                          <tr>
                            <th>الطلب</th>
                            <th>المشتري</th>
                            <th>أمر العمل</th>
                            <th>الدفع</th>
                            <th className="end">الإجمالي</th>
                            <th className="end">المستحق</th>
                            <th>الاستحقاق</th>
                          </tr>
                        </thead>
                        <tbody>
                          {d.orders.map((x) => (
                            <tr key={x.id}>
                              <td>
                                <Link href={`/orders/${x.id}`} className="num">
                                  {x.number}
                                </Link>
                                <div className="cell-sub">
                                  <StatusChip kind="order" value={x.status} /> {x.workshopQuoteId ? <Chip tone="info">من عرض سعر</Chip> : null}
                                </div>
                              </td>
                              <td>{x.buyerName ?? '—'}</td>
                              <td>{x.workOrderRef ?? '—'}</td>
                              <td>{x.paymentMethod === 'NET_TERMS' ? <Chip tone="info">آجل</Chip> : x.paymentMethod}</td>
                              <td className="end">
                                <Money h={x.totalHalalas} />
                              </td>
                              <td className="end">{x.outstandingHalalas ? <Money h={x.outstandingHalalas} /> : '—'}</td>
                              <td>{x.creditDueAt ? <span className={x.overdue ? 'neg' : ''}>{x.overdue ? 'متأخر · ' : ''}<DateTime iso={x.creditDueAt} /></span> : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty>لا توجد طلبات بعد</Empty>
                  )}
                </Card>
                <Card title="سجل النشاط">
                  {d.activity.length ? (
                    <ul className="stack-sm">
                      {d.activity.map((a) => (
                        <li key={a.id} className="row gap-sm">
                          <DateTime iso={a.createdAt} /> <span className="num">{a.action}</span> <span className="muted">{a.actorType}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <Empty />
                  )}
                </Card>
              </div>
              <div className="stack">
                <Card
                  title="الدفع الآجل"
                  actions={<SandboxTag>حد داخلي تجريبي</SandboxTag>}
                >
                  {d.creditLine ? (
                    <KV
                      items={[
                        ['الحد', <Money key="l" h={d.credit.limitHalalas} />],
                        ['المستخدم', <Money key="u" h={d.credit.outstandingHalalas} />],
                        ['المتاح', <Money key="a" h={d.credit.availableHalalas} />],
                        ['متأخر', d.credit.overdueHalalas ? <Money key="o" h={d.credit.overdueHalalas} className="neg" /> : '—'],
                        ['مدة السداد', `${d.credit.termsDays} يوماً`],
                        ['أقرب استحقاق', <DateTime key="n" iso={d.credit.nextDueAt} />],
                        ['المزوّد', <span key="p" className="num">{d.credit.provider}</span>],
                      ]}
                    />
                  ) : (
                    <p className="muted">لا يوجد حد ائتماني. لا يوجد شريك تمويل بعد؛ الحد يُدار داخلياً في قطعة (بيئة تجريبية).</p>
                  )}
                  {canCredit ? (
                    <div className="row gap-sm wrap" style={{ marginBlockStart: 12 }}>
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={o.status !== 'APPROVED'}
                        onClick={() => {
                          setLimit(d.creditLine ? (d.creditLine.limitHalalas / 100).toFixed(2) : '');
                          setTerms(String(d.creditLine?.termsDays ?? 30));
                          setError(null);
                          setCreditOpen(true);
                        }}
                      >
                        {d.creditLine ? 'تعديل الحد' : 'تفعيل الآجل'}
                      </button>
                      {d.creditLine ? (
                        <ConfirmButton
                          label={frozen ? 'إلغاء التجميد' : 'تجميد الآجل'}
                          tone={frozen ? 'primary' : 'danger'}
                          title={frozen ? 'إلغاء تجميد الآجل' : 'تجميد الآجل'}
                          message={frozen ? 'ستتمكن الورشة من الطلب بالدفع الآجل مجدداً.' : 'لن تتمكن الورشة من الطلب بالدفع الآجل حتى إلغاء التجميد. الطلبات القائمة لا تتأثر.'}
                          onConfirm={() => run('freeze', () => api(`v1/ops/organizations/${id}/credit`, { method: 'PUT', body: { status: frozen ? 'ACTIVE' : 'FROZEN' } }), frozen ? 'أُلغي التجميد' : 'جُمّد الآجل').then(state.reload)}
                        />
                      ) : null}
                      {has('FINANCE') && d.credit.outstandingHalalas > 0 ? (
                        <button
                          className="btn btn-sm"
                          onClick={() => {
                            setRepayKey(newIdempotencyKey());
                            setAmount('');
                            setReference('');
                            setError(null);
                            setRepayOpen(true);
                          }}
                        >
                          تسجيل سداد
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </Card>
                <Card title="السدادات" flush>
                  {d.repayments.length ? (
                    <table className="t">
                      <tbody>
                        {d.repayments.map((r) => (
                          <tr key={r.id}>
                            <td>
                              <DateTime iso={r.createdAt} />
                              <div className="cell-sub">{r.reference ?? ''}</div>
                            </td>
                            <td className="end">
                              <Money h={r.amountHalalas} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <Empty>لا توجد سدادات</Empty>
                  )}
                </Card>
                <Card title="الأعضاء" flush>
                  <table className="t">
                    <tbody>
                      {d.members.map((m) => (
                        <tr key={m.id}>
                          <td>
                            {m.name ?? '—'}
                            <div className="cell-sub">
                              <bdi className="num">{m.phone ?? ''}</bdi>
                            </div>
                          </td>
                          <td>{ROLE[m.role] ?? m.role}</td>
                          <td>{m.status === 'INVITED' ? <Chip tone="info">مدعو</Chip> : <Chip tone="success">نشط</Chip>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              </div>
            </div>

            <Dialog open={!!decision} onClose={() => setDecision(null)} title={decision === 'reject' ? 'رفض طلب الورشة' : 'إيقاف الورشة'} submitLabel={decision === 'reject' ? 'رفض' : 'إيقاف'} submitTone="danger" pending={pending} onSubmit={decide}>
              <Field label="السبب (يظهر لمالك الورشة)" error={error}>
                <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
              </Field>
            </Dialog>
            <Dialog open={creditOpen} onClose={() => setCreditOpen(false)} title="الحد الائتماني (داخلي — تجريبي)" pending={pending} onSubmit={saveCredit} sandbox>
              <Field label="الحد بالريال" error={error}>
                <input inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} dir="ltr" />
              </Field>
              <Field label="مدة السداد (أيام)">
                <input inputMode="numeric" value={terms} onChange={(e) => setTerms(e.target.value)} dir="ltr" />
              </Field>
            </Dialog>
            <Dialog open={repayOpen} onClose={() => setRepayOpen(false)} title="تسجيل سداد من الورشة" pending={pending} onSubmit={repay}>
              <p className="muted">يُوزَّع السداد على أقدم الطلبات استحقاقاً. المستحق الآن {formatSar(d.credit.outstandingHalalas)}.</p>
              <Field label="المبلغ بالريال" error={error}>
                <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} dir="ltr" />
              </Field>
              <Field label="مرجع التحويل البنكي (اختياري)">
                <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={120} dir="ltr" />
              </Field>
            </Dialog>
          </>
        );
      }}
    </Async>
  );
}
