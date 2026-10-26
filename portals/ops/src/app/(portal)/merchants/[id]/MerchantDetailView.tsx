'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';

import { useSession } from '@/components/Session';
import { useToast } from '@/components/Toasts';
import { Async, Card, ConfirmButton, DateTime, Dialog, Empty, Field, KV, Money, PageHead, StatusChip } from '@/components/ui';
import { api, post } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import { cityName, formatMinutes } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { DOC_TYPE_LABEL, MEMBER_ROLE_LABEL, statusLabel } from '@/lib/labels';
import type { MerchantDetail } from '@/lib/types';

type Decision = 'approve' | 'reject' | 'suspend';

export function MerchantDetailView() {
  const { id } = useParams<{ id: string }>();
  const state = useApi<MerchantDetail>(`v1/ops/merchants/${id}`, { live: (e) => e.entityType === 'merchant' && e.entityId === id });
  const { isAdmin } = useSession();
  const { run } = useAction();
  const { push } = useToast();
  const [dialog, setDialog] = useState<Decision | null>(null);
  const [reason, setReason] = useState('');
  const [bps, setBps] = useState('');
  const [pending, setPending] = useState(false);

  const open = (d: Decision) => {
    setReason('');
    setBps(state.data ? String(state.data.commissionBps) : '');
    setDialog(d);
  };

  async function submitDecision() {
    if (!dialog) return;
    const body: { reason?: string; commissionBps?: number } = {};
    if (dialog === 'approve') {
      if (bps.trim()) {
        const n = Number(bps.trim());
        if (!Number.isInteger(n) || n < 0 || n > 5000) {
          push({ tone: 'danger', title: 'العمولة يجب أن تكون عدداً صحيحاً بين 0 و5000 نقطة أساس' });
          return;
        }
        body.commissionBps = n;
      }
      if (reason.trim()) body.reason = reason.trim();
    } else {
      if (reason.trim().length < 2) {
        push({ tone: 'danger', title: 'اكتب السبب' });
        return;
      }
      body.reason = reason.trim();
    }
    setPending(true);
    const r = await run('decision', () => post(`v1/ops/merchants/${id}/${dialog}`, body), { approve: 'تم اعتماد التاجر', reject: 'تم رفض الطلب', suspend: 'تم إيقاف التاجر' }[dialog]);
    setPending(false);
    if (r) {
      setDialog(null);
      state.reload();
    }
  }

  async function viewDocument(key: string) {
    try {
      const { url } = await api<{ url: string }>(`v1/ops/uploads?key=${encodeURIComponent(key)}`);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      push({ tone: 'danger', title: 'تعذر فتح المستند', body: errorMessage(e) });
    }
  }

  return (
    <Async state={state} rows={6}>
      {(m) => {
        const canDecide = isAdmin && (m.status === 'APPLIED' || m.status === 'UNDER_REVIEW');
        return (
          <>
            <PageHead
              crumbs={[{ href: '/merchants', label: 'التجار' }]}
              title={
                <span className="row gap-sm wrap">
                  {m.displayNameAr} <StatusChip kind="merchant" value={m.status} />
                </span>
              }
              sub={`${m.displayNameEn} · ${m.legalName}`}
              actions={
                isAdmin ? (
                  <>
                    {canDecide ? (
                      <>
                        <button className="btn btn-primary" onClick={() => open('approve')} data-testid="approve-merchant">
                          اعتماد
                        </button>
                        <button className="btn btn-danger" onClick={() => open('reject')}>
                          رفض
                        </button>
                      </>
                    ) : null}
                    {m.status === 'APPROVED' ? (
                      <button className="btn btn-danger" onClick={() => open('suspend')}>
                        إيقاف مؤقت
                      </button>
                    ) : null}
                    {m.status === 'SUSPENDED' ? (
                      <ConfirmButton
                        size="md"
                        label="إعادة التفعيل"
                        title="إعادة تفعيل التاجر"
                        message={`سيعود ${m.displayNameAr} معتمداً وتظهر عروضه للعملاء.`}
                        onConfirm={() => run('reinstate', () => post(`v1/ops/merchants/${id}/reinstate`), 'أُعيد تفعيل التاجر').then(state.reload)}
                      />
                    ) : null}
                  </>
                ) : null
              }
            />
            {m.statusReason ? <div className="alert alert-warning" style={{ marginBlockEnd: 16 }}>سبب الحالة: {m.statusReason}</div> : null}
            <div className="grid grid-main-side">
              <div className="stack">
                <Card title="بيانات المنشأة">
                  <KV
                    items={[
                      ['الاسم القانوني', m.legalName],
                      ['السجل التجاري', <span className="num" key="cr">{m.crNumber}</span>],
                      ['الرقم الضريبي', m.vatNumber ? <span className="num">{m.vatNumber}</span> : null],
                      ['المدينة', cityName(m.city)],
                      ['التخصص', m.specialtyAr || null],
                      ['البريد', <bdi key="e">{m.contactEmail}</bdi>],
                      ['الجوال', <bdi key="p" className="num">{m.contactPhone}</bdi>],
                      ['العمولة', <span className="num" key="c">{(m.commissionBps / 100).toFixed(2)}% ({m.commissionBps} bps)</span>],
                      ['مهلة القبول', formatMinutes(m.slaAcceptMinutes)],
                      ['مهلة التجهيز', formatMinutes(m.slaReadyMinutes)],
                      ['توصيل للورش', m.supportsWorkshopDelivery ? 'نعم' : 'لا'],
                      ['تاريخ الاعتماد', <DateTime key="a" iso={m.approvedAt} />],
                      ['تاريخ التسجيل', <DateTime key="cr2" iso={m.createdAt} />],
                    ]}
                  />
                </Card>
                <Card title="التحقق والمستندات" flush>
                  {m.verifications.length ? (
                    <div className="table-wrap">
                      <table className="t">
                        <thead>
                          <tr>
                            <th>التاريخ</th>
                            <th>الحالة</th>
                            <th>المستندات</th>
                            <th>ملاحظات</th>
                            <th>المراجعة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.verifications.map((v) => (
                            <tr key={v.id}>
                              <td>
                                <DateTime iso={v.createdAt} />
                              </td>
                              <td>
                                <StatusChip kind="verification" value={v.status} />
                              </td>
                              <td>
                                <ul style={{ margin: 0, paddingInlineStart: 16 }}>
                                  {(v.documents ?? []).map((d, i) => (
                                    <li key={i}>
                                      {DOC_TYPE_LABEL[d.type ?? ''] ?? d.type ?? 'مستند'}
                                      {d.reference ? (
                                        <>
                                          {' '}
                                          <span className="num muted">({d.reference})</span>
                                        </>
                                      ) : null}{' '}
                                      {d.fileKey ? (
                                        <button type="button" className="btn btn-sm" onClick={() => viewDocument(d.fileKey!)}>
                                          عرض المستند
                                        </button>
                                      ) : null}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                              <td>{v.notes ?? <span className="muted">—</span>}</td>
                              <td>
                                {v.reviewedAt ? (
                                  <>
                                    <DateTime iso={v.reviewedAt} />
                                    {v.reviewNote ? <div className="cell-sub">{v.reviewNote}</div> : null}
                                  </>
                                ) : (
                                  <span className="muted">لم تُراجع</span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty>لم تُرسل مستندات</Empty>
                  )}
                </Card>
                <Card title="مواقع الاستلام" flush>
                  {m.locations.length ? (
                    <div className="table-wrap">
                      <table className="t">
                        <thead>
                          <tr>
                            <th>الموقع</th>
                            <th>العنوان</th>
                            <th>الجوال</th>
                            <th>الحالة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {m.locations.map((l) => (
                            <tr key={l.id}>
                              <td>{l.name}</td>
                              <td>
                                {l.street}، {l.district}، {cityName(l.city)}
                              </td>
                              <td className="num">
                                <bdi>{l.contactPhone}</bdi>
                              </td>
                              <td>{l.active ? <span className="chip chip-success">نشط</span> : <span className="chip chip-neutral">متوقف</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Empty>لا توجد مواقع</Empty>
                  )}
                </Card>
                <Card title="الأعضاء" flush>
                  <div className="table-wrap">
                    <table className="t">
                      <thead>
                        <tr>
                          <th>الاسم</th>
                          <th>البريد / الجوال</th>
                          <th>الدور</th>
                          <th>الحالة</th>
                        </tr>
                      </thead>
                      <tbody>
                        {m.members.map((mm) => (
                          <tr key={mm.id}>
                            <td>{mm.user.name ?? '—'}</td>
                            <td>
                              <bdi>{mm.user.email ?? mm.user.phone}</bdi>
                            </td>
                            <td>{MEMBER_ROLE_LABEL[mm.role] ?? mm.role}</td>
                            <td>{mm.status === 'ACTIVE' ? 'نشط' : 'معطّل'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </Card>
              </div>
              <div className="stack">
                <Card title="الرصيد (من دفتر الأستاذ)">
                  <KV
                    items={[
                      ['مستحق للتاجر', <Money key="p" h={m.balance.payableHalalas} />],
                      ['عمولة المنصة', <Money key="c" h={m.balance.commissionHalalas} />],
                      ['المحوّل للتاجر', <Money key="o" h={m.balance.paidOutHalalas} />],
                    ]}
                  />
                </Card>
                <Card title="إحصاءات الطلبات">
                  <KV items={[['العروض', <span className="num" key="o">{m._count.offers}</span>], ['الطلبات الفرعية', <span className="num" key="m">{m._count.merchantOrders}</span>]]} />
                  {m.orderStats.length ? (
                    <table className="t" style={{ marginBlockStart: 12 }}>
                      <tbody>
                        {m.orderStats.map((s) => (
                          <tr key={s.status}>
                            <td>{statusLabel('merchantOrder', s.status)}</td>
                            <td className="end num">{s._count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : null}
                </Card>
                <Card title="روابط">
                  <div className="col gap-sm" style={{ alignItems: 'flex-start' }}>
                    <Link href={`/audit?merchantId=${m.id}`}>سجل التدقيق لهذا التاجر</Link>
                  </div>
                </Card>
              </div>
            </div>

            <Dialog
              open={dialog !== null}
              onClose={() => setDialog(null)}
              title={dialog === 'approve' ? `اعتماد ${m.displayNameAr}` : dialog === 'reject' ? `رفض طلب ${m.displayNameAr}` : `إيقاف ${m.displayNameAr}`}
              submitLabel={dialog === 'approve' ? 'اعتماد التاجر' : dialog === 'reject' ? 'رفض الطلب' : 'إيقاف التاجر'}
              submitTone={dialog === 'approve' ? 'primary' : 'danger'}
              pending={pending}
              onSubmit={submitDecision}
            >
              {dialog === 'approve' ? (
                <>
                  <p>سيتمكن التاجر من نشر عروضه واستقبال الطلبات. المستندات المعلقة ستُعلّم مقبولة.</p>
                  <Field label="العمولة (نقطة أساس) — اختياري" hint="1000 = 10%. اتركها كما هي للإبقاء على العمولة الحالية.">
                    <input inputMode="numeric" dir="ltr" value={bps} onChange={(e) => setBps(e.target.value)} name="commissionBps" />
                  </Field>
                  <Field label="ملاحظة للتاجر — اختياري">
                    <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
                  </Field>
                </>
              ) : (
                <Field label="السبب (يُرسل للتاجر)">
                  <textarea required minLength={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} name="reason" />
                </Field>
              )}
            </Dialog>
          </>
        );
      }}
    </Async>
  );
}
