'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { useSession } from '@/components/Session';
import { Async, Card, ConfirmButton, DateTime, Dialog, Empty, Field, Money, PageHead, Pills, StatusChip } from '@/components/ui';
import { post, qs } from '@/lib/api';
import { useAction, useApi } from '@/lib/hooks';
import { RETURN_REASON_LABEL } from '@/lib/labels';
import { formatSar, parseSarToHalalas } from '@/lib/money';
import { returnActions } from '@/lib/states';
import type { ReturnListItem } from '@/lib/types';

type F = 'OPEN' | 'REQUESTED' | 'APPROVED' | 'IN_TRANSIT' | 'RECEIVED' | 'DONE' | 'ALL';
const FILTERS: { value: F; label: string; status?: string }[] = [
  { value: 'OPEN', label: 'مفتوحة', status: 'REQUESTED,APPROVED,IN_TRANSIT,RECEIVED' },
  { value: 'REQUESTED', label: 'طلبات جديدة', status: 'REQUESTED' },
  { value: 'APPROVED', label: 'بانتظار الاستلام', status: 'APPROVED' },
  { value: 'IN_TRANSIT', label: 'في الطريق', status: 'IN_TRANSIT' },
  { value: 'RECEIVED', label: 'بانتظار الفحص', status: 'RECEIVED' },
  { value: 'DONE', label: 'منتهية', status: 'REFUNDED,REJECTED,CLOSED' },
  { value: 'ALL', label: 'الكل' },
];

export function ReturnsView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const focus = params.get('focus');
  const filter = (FILTERS.find((f) => f.value === params.get('f'))?.value ?? (focus ? 'ALL' : 'OPEN')) as F;
  const state = useApi<{ items: ReturnListItem[] }>(`v1/ops/returns${qs({ status: FILTERS.find((f) => f.value === filter)?.status })}`, {
    live: (e) => e.entityType === 'return_case' || e.entityType === 'shipment' || e.type.startsWith('refund.'),
  });
  const { has } = useSession();
  const { run, pending } = useAction();
  const [dialog, setDialog] = useState<null | { kind: 'approve' | 'reject' | 'inspect'; rc: ReturnListItem }>(null);
  const [note, setNote] = useState('');
  const [accept, setAccept] = useState(true);
  const [restock, setRestock] = useState(true);
  const [partial, setPartial] = useState('');
  const [err, setErr] = useState<string | null>(null);

  const itemValue = (rc: ReturnListItem) => rc.items.reduce((s, i) => s + i.orderItem.unitPriceHalalas * i.quantity, 0);
  const open = (kind: 'approve' | 'reject' | 'inspect', rc: ReturnListItem) => {
    setNote('');
    setAccept(true);
    setRestock(true);
    setPartial('');
    setErr(null);
    setDialog({ kind, rc });
  };

  async function submit() {
    if (!dialog) return;
    const { kind, rc } = dialog;
    let body: Record<string, unknown> = {};
    if (kind === 'approve') body = note.trim() ? { note: note.trim() } : {};
    if (kind === 'reject') {
      if (note.trim().length < 2) return setErr('اكتب سبب الرفض');
      body = { note: note.trim() };
    }
    if (kind === 'inspect') {
      body = { accept, restock: accept && restock, ...(note.trim() ? { note: note.trim() } : {}) };
      if (accept && partial.trim()) {
        const h = parseSarToHalalas(partial);
        if (h === null || h <= 0) return setErr('مبلغ الاسترداد الجزئي غير صالح');
        if (h > itemValue(rc)) return setErr(`الحد الأقصى ${formatSar(itemValue(rc))}`);
        body.refundHalalas = h;
      }
    }
    setErr(null);
    const ok = await run(kind, () => post(`v1/ops/returns/${rc.id}/${kind}`, body), { approve: 'تمت الموافقة — أُنشئت شحنة إرجاع في برج التحكم', reject: 'رُفض المرتجع', inspect: 'سُجّلت نتيجة الفحص' }[kind]);
    if (ok) {
      setDialog(null);
      state.reload();
    }
  }

  return (
    <>
      <PageHead title="المرتجعات والخدمات العكسية" sub="الموافقة تُنشئ شحنة إرجاع تظهر في برج التحكم للبوليصة والاستلام من العميل" />
      <div className="toolbar">
        <Pills label="الحالة" value={filter} onChange={(v) => router.replace(`${pathname}?f=${v}`)} options={FILTERS} />
      </div>
      <Card flush>
        <Async state={state}>
          {(d) =>
            d.items.length ? (
              <div className="table-wrap">
                <table className="t">
                  <thead>
                    <tr>
                      <th>المرتجع</th>
                      <th>التاجر</th>
                      <th>الحالة</th>
                      <th>السبب</th>
                      <th>الأصناف</th>
                      <th>شحنة الإرجاع</th>
                      <th className="end">الاسترداد</th>
                      <th>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.items.map((rc) => {
                      const ship = rc.shipments[rc.shipments.length - 1];
                      return (
                        <tr key={rc.id} style={focus === rc.id ? { outline: '2px solid var(--blue-500)' } : undefined}>
                          <td>
                            <span className="num">{rc.number}</span>
                            <div className="cell-sub">
                              <Link href={`/orders/${rc.orderId}`} className="num">
                                {rc.order.number}
                              </Link>{' '}
                              · <DateTime iso={rc.createdAt} />
                            </div>
                          </td>
                          <td>{rc.merchant.displayNameAr}</td>
                          <td>
                            <StatusChip kind="return" value={rc.status} />
                          </td>
                          <td>
                            {RETURN_REASON_LABEL[rc.reason] ?? rc.reason}
                            {rc.customerNote ? <div className="cell-sub">«{rc.customerNote}»</div> : null}
                            {rc.decisionNote ? <div className="cell-sub">القرار: {rc.decisionNote}</div> : null}
                            {rc.inspectionNote ? <div className="cell-sub">الفحص: {rc.inspectionNote}</div> : null}
                          </td>
                          <td className="small">
                            {rc.items.map((i) => (
                              <div key={i.id}>
                                {i.orderItem.productNameAr} × <span className="num">{i.quantity}</span>
                              </div>
                            ))}
                            <div className="cell-sub">
                              القيمة <Money h={itemValue(rc)} />
                            </div>
                          </td>
                          <td>
                            {ship ? (
                              <Link href={`/tower/shipments/${ship.id}`}>
                                <StatusChip kind="shipment" value={ship.status} />
                              </Link>
                            ) : (
                              <span className="muted">—</span>
                            )}
                          </td>
                          <td className="end">
                            {rc.refundHalalas ? <Money h={rc.refundHalalas} /> : <span className="muted">—</span>}
                            {rc.refunds.map((r) => (
                              <div key={r.id}>
                                <StatusChip kind="refund" value={r.status} />
                              </div>
                            ))}
                          </td>
                          <td>
                            {has('OPS_AGENT') ? (
                              <div className="row gap-sm wrap">
                                {returnActions(rc.status)
                                  // After an accepted inspection the case stays RECEIVED until the refund webhook arrives.
                                  .filter((a) => !(a === 'inspect' && rc.refunds.length > 0))
                                  .map((a) =>
                                  a === 'receive' ? (
                                    <ConfirmButton
                                      key={a}
                                      label="تأكيد الاستلام"
                                      title={`استلام المرتجع ${rc.number}`}
                                      message="تأكيد وصول القطعة للتاجر (تسليم يدوي أو بدون تتبع الناقل). بعدها يمكن الفحص."
                                      onConfirm={() => run('receive', () => post(`v1/ops/returns/${rc.id}/receive`), 'سُجّل الاستلام').then(state.reload)}
                                    />
                                  ) : (
                                    <button key={a} className={`btn btn-sm ${a === 'reject' ? 'btn-danger' : a === 'approve' ? 'btn-primary' : ''}`} onClick={() => open(a, rc)}>
                                      {{ approve: 'موافقة', reject: 'رفض', inspect: 'نتيجة الفحص' }[a]}
                                    </button>
                                  ),
                                )}
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty>لا توجد مرتجعات</Empty>
            )
          }
        </Async>
      </Card>

      <Dialog
        open={!!dialog}
        onClose={() => setDialog(null)}
        title={dialog ? `${{ approve: 'الموافقة على', reject: 'رفض', inspect: 'فحص' }[dialog.kind]} المرتجع ${dialog.rc.number}` : ''}
        submitLabel={dialog?.kind === 'reject' ? 'رفض' : dialog?.kind === 'approve' ? 'موافقة وإنشاء شحنة إرجاع' : 'حفظ النتيجة'}
        submitTone={dialog?.kind === 'reject' || (dialog?.kind === 'inspect' && !accept) ? 'danger' : 'primary'}
        pending={!!pending}
        onSubmit={submit}
      >
        {dialog?.kind === 'approve' ? (
          <>
            <p>ستُنشأ شحنة إرجاع (من العميل إلى موقع التاجر) تظهر في برج التحكم لإنشاء البوليصة وجدولة الاستلام.</p>
            <Field label="ملاحظة — اختياري">
              <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        ) : null}
        {dialog?.kind === 'reject' ? (
          <Field label="سبب الرفض (يُرسل للعميل)">
            <textarea required minLength={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        ) : null}
        {dialog?.kind === 'inspect' ? (
          <>
            <div className="row gap wrap" role="radiogroup" aria-label="نتيجة الفحص">
              <label className="check">
                <input type="radio" name="accept" checked={accept} onChange={() => setAccept(true)} /> اجتاز الفحص — استرداد
              </label>
              <label className="check">
                <input type="radio" name="accept" checked={!accept} onChange={() => setAccept(false)} /> لم يجتز — إغلاق دون استرداد
              </label>
            </div>
            {accept ? (
              <>
                <label className="check">
                  <input type="checkbox" checked={restock} onChange={(e) => setRestock(e.target.checked)} /> إعادة القطعة للمخزون
                </label>
                <Field label="استرداد جزئي (ر.س) — اختياري" hint={`اتركه فارغاً لاسترداد كامل قيمة الأصناف (${formatSar(itemValue(dialog.rc))})`}>
                  <input inputMode="decimal" dir="ltr" placeholder="0.00" value={partial} onChange={(e) => setPartial(e.target.value)} />
                </Field>
              </>
            ) : null}
            <Field label="ملاحظة الفحص — اختياري">
              <input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          </>
        ) : null}
        {err ? (
          <div className="alert alert-danger" role="alert">
            {err}
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
