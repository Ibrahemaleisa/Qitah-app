'use client';

import { useState } from 'react';

import { post } from '@/lib/api';
import { addDays, formatDateTime, formatMinutes, riyadhDate, riyadhHour, riyadhToIso } from '@/lib/format';
import { useAction, useNow } from '@/lib/hooks';
import { SOURCE_LABEL, statusLabel, statusTone } from '@/lib/labels';
import { canCreateLabel, canSchedulePickup, manualEventsFrom, merchantOrderActions, MO_ACTION_LABEL, sandboxScansFrom, type MoAction } from '@/lib/states';
import type { MerchantOrderStatus, Shipment, ShipmentEvent, ShipmentStatus } from '@/lib/types';

import { useSession } from './Session';
import { useToast } from './Toasts';
import { ConfirmButton, Dialog, Field, Mono, SandboxTag } from './ui';

/** SLA countdown: minutes left until `due` (red when breached, amber under an hour). */
export function SlaCell({ due, breached, label }: { due: string | null; breached?: boolean; label?: string }) {
  const now = useNow(30_000);
  if (!due) return <span className="muted">—</span>;
  const mins = Math.round((new Date(due).getTime() - now) / 60_000);
  const cls = breached || mins < 0 ? 'sla-breach' : mins < 60 ? 'sla-soon' : 'sla-ok';
  return (
    <span className={`sla ${cls}`} title={`${label ?? 'المهلة'}: ${formatDateTime(due)}`} data-testid="sla">
      {mins < 0 ? `متأخر ${formatMinutes(mins)}` : `متبقٍ ${formatMinutes(mins)}`}
    </span>
  );
}

export function ShipmentTimeline({ events }: { events: ShipmentEvent[] }) {
  if (!events.length) return <p className="muted">لا توجد أحداث تتبع بعد</p>;
  return (
    <ol className="timeline">
      {events.map((e) => (
        <li key={e.id} className={`t-${statusTone('shipment', e.status)}`}>
          <div className="tl-head">
            <strong>{statusLabel('shipment', e.status)}</strong>
            <span className="tl-meta num">{formatDateTime(e.occurredAt)}</span>
            <span className="chip chip-neutral">{SOURCE_LABEL[e.source] ?? e.source}</span>
          </div>
          <div className="tl-meta">
            {e.description}
            {e.location ? ` — ${e.location}` : ''}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Ops acting on the merchant's behalf (accept / pack / ready / reject), always with confirmation. */
export function MerchantOrderActions({ id, number, status, onDone }: { id: string; number: string; status: MerchantOrderStatus; onDone: () => void }) {
  const { has } = useSession();
  const { run } = useAction();
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [pending, setPending] = useState(false);
  const actions = merchantOrderActions(status);
  if (!has('OPS_AGENT') || !actions.length) return null;
  const msg: Record<MoAction, string> = {
    accept: `قبول ${number} نيابةً عن التاجر (مثلاً بعد تأكيد هاتفي). يُسجّل الإجراء باسمك.`,
    pack: `تعليم ${number} كقيد التغليف نيابةً عن التاجر.`,
    ready: `تعليم ${number} كجاهز للاستلام نيابةً عن التاجر. ستُنشأ شحنة بانتظار البوليصة.`,
    reject: '',
  };
  return (
    <div className="row gap-sm wrap">
      {actions
        .filter((a) => a !== 'reject')
        .map((a) => (
          <ConfirmButton
            key={a}
            label={MO_ACTION_LABEL[a]}
            title={`${MO_ACTION_LABEL[a]} — نيابةً عن التاجر`}
            message={msg[a]}
            testId={`mo-${a}`}
            onConfirm={() => run(a, () => post(`v1/ops/merchant-orders/${id}/${a}`), `تم: ${MO_ACTION_LABEL[a]} (${number})`).then(onDone)}
          />
        ))}
      {actions.includes('reject') ? (
        <>
          <button className="btn btn-sm btn-danger" onClick={() => (setReason(''), setRejectOpen(true))}>
            رفض
          </button>
          <Dialog
            open={rejectOpen}
            onClose={() => setRejectOpen(false)}
            title={`رفض ${number} نيابةً عن التاجر`}
            submitLabel="رفض واسترداد"
            submitTone="danger"
            pending={pending}
            onSubmit={async () => {
              if (reason.trim().length < 2) return;
              setPending(true);
              const r = await run('reject', () => post(`v1/ops/merchant-orders/${id}/reject`, { reason: reason.trim() }), `رُفض ${number}`);
              setPending(false);
              if (r) {
                setRejectOpen(false);
                onDone();
              }
            }}
          >
            <p>سيُعاد المخزون وتُلغى الشحنات غير المستلمة ويُسترد للعميل نصيب هذا التاجر شاملاً الشحن.</p>
            <Field label="السبب">
              <textarea required minLength={2} maxLength={200} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          </Dialog>
        </>
      ) : null}
    </div>
  );
}

/** Pickup window picker in Riyadh time with quick presets. Returns ISO instants. */
export function PickupWindowFields({ value, onChange }: { value: { date: string; start: string; end: string }; onChange: (v: { date: string; start: string; end: string }) => void }) {
  const today = riyadhDate();
  const tomorrow = addDays(today, 1);
  const h = riyadhHour();
  const presets = [
    ...(h >= 5 && h < 14 ? [{ day: 'اليوم', range: `${String(h + 1).padStart(2, '0')}:00–${String(h + 3).padStart(2, '0')}:00`, v: { date: today, start: `${String(h + 1).padStart(2, '0')}:00`, end: `${String(h + 3).padStart(2, '0')}:00` } }] : []),
    { day: 'غداً', range: '09:00–12:00', v: { date: tomorrow, start: '09:00', end: '12:00' } },
    { day: 'غداً', range: '13:00–17:00', v: { date: tomorrow, start: '13:00', end: '17:00' } },
  ];
  const hours = Array.from({ length: 33 }, (_, i) => `${String(6 + Math.floor(i / 2)).padStart(2, '0')}:${i % 2 ? '30' : '00'}`);
  return (
    <>
      <div className="presets" role="group" aria-label="نوافذ مقترحة">
        {presets.map((p) => (
          <button key={p.day + p.range} type="button" className="pill" onClick={() => onChange(p.v)}>
            {p.day} <bdi dir="ltr">{p.range}</bdi>
          </button>
        ))}
      </div>
      <div className="grid grid-3" style={{ gap: 8 }}>
        <Field label="التاريخ">
          <input type="date" required min={today} value={value.date} onChange={(e) => onChange({ ...value, date: e.target.value })} name="pickupDate" />
        </Field>
        <Field label="من">
          <select value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} name="pickupStart">
            {hours.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label="إلى">
          <select value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} name="pickupEnd">
            {hours.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
      </div>
      <p className="field-hint">بتوقيت الرياض (UTC+3). يُرسل للناقل ويُبلّغ التاجر بموعد حضور المندوب.</p>
    </>
  );
}

export function defaultPickupWindow() {
  const h = riyadhHour();
  if (h >= 5 && h < 14) return { date: riyadhDate(), start: `${String(h + 1).padStart(2, '0')}:00`, end: `${String(h + 3).padStart(2, '0')}:00` };
  return { date: addDays(riyadhDate(), 1), start: '09:00', end: '12:00' };
}

export function windowToIso(w: { date: string; start: string; end: string }) {
  return { windowStart: riyadhToIso(w.date, w.start), windowEnd: riyadhToIso(w.date, w.end) };
}

type ActionShipment = Pick<Shipment, 'id' | 'status' | 'sandbox' | 'trackingNumber' | 'labelUrl' | 'direction'>;

/**
 * All control-tower actions for one shipment, offering only transitions valid from its status:
 * label → pickup → manual event → sandbox carrier simulation.
 */
export function ShipmentActions({ shipment, onDone, compact, preface }: { shipment: ActionShipment; onDone: () => void; compact?: boolean; preface?: ShipmentStatus }) {
  const { has } = useSession();
  const { run, pending } = useAction();
  const { push } = useToast();
  const [dialog, setDialog] = useState<null | 'pickup' | 'event'>(null);
  const [win, setWin] = useState(defaultPickupWindow);
  const [evStatus, setEvStatus] = useState<ShipmentStatus | ''>('');
  const [evDesc, setEvDesc] = useState('');
  const [evLoc, setEvLoc] = useState('');
  const s = shipment.status;
  if (!has('OPS_AGENT')) return null;

  const scans = shipment.sandbox ? sandboxScansFrom(s) : [];
  const manual = manualEventsFrom(s);

  const createLabel = () =>
    run('label', () => post<Shipment>(`v1/ops/shipments/${shipment.id}/label`)).then((r) => {
      if (r) {
        push({ tone: 'success', title: 'أُنشئت البوليصة', body: `رقم التتبع ${r.trackingNumber ?? ''}` });
        onDone();
      }
    });

  const schedule = async () => {
    const body = windowToIso(win);
    if (new Date(body.windowEnd) <= new Date(body.windowStart)) {
      push({ tone: 'danger', title: 'نهاية النافذة يجب أن تكون بعد بدايتها' });
      return;
    }
    const r = await run('pickup', async () => {
      // A missed pickup (still PICKUP_SCHEDULED) must first be recorded as failed before rebooking.
      if (preface === 'PICKUP_FAILED' && s === 'PICKUP_SCHEDULED') {
        await post(`v1/ops/shipments/${shipment.id}/events`, { status: 'PICKUP_FAILED', description: 'انقضت نافذة الاستلام دون حضور المندوب — إعادة جدولة' });
      }
      return post(`v1/ops/shipments/${shipment.id}/pickup`, body);
    }, 'تمت جدولة الاستلام');
    if (r) {
      setDialog(null);
      onDone();
    }
  };

  const recordEvent = async () => {
    if (!evStatus || evDesc.trim().length < 2) return;
    const r = await run('event', () => post(`v1/ops/shipments/${shipment.id}/events`, { status: evStatus, description: evDesc.trim(), ...(evLoc.trim() ? { location: evLoc.trim() } : {}) }), 'سُجّل الحدث');
    if (r) {
      setDialog(null);
      onDone();
    }
  };

  const simulate = (to: ShipmentStatus) =>
    run(`sim-${to}`, async () => {
      const r = await post<{ delivered: boolean; response: { outcome?: string; detail?: string } }>(`v1/ops/shipments/${shipment.id}/sandbox-event`, { status: to });
      if (!r.delivered || r.response?.outcome === 'rejected') throw new Error(`رفض الناقل التجريبي الحدث: ${r.response?.detail ?? 'انتقال غير صالح'}`);
      return r;
    }).then((r) => {
      if (r) {
        push({ tone: 'success', title: `محاكاة: ${statusLabel('shipment', to)}` });
        onDone();
      }
    });

  const rescheduleMode = preface === 'PICKUP_FAILED' && s === 'PICKUP_SCHEDULED';
  const btn = compact ? 'btn btn-sm' : 'btn';

  return (
    <div className="col gap-sm" style={{ alignItems: 'stretch' }}>
      <div className="row gap-sm wrap">
        {canCreateLabel(s) ? (
          <button className={`${btn} btn-primary`} disabled={!!pending} onClick={createLabel} data-testid="create-label">
            {pending === 'label' ? 'جارٍ الإنشاء…' : 'إنشاء بوليصة'}
          </button>
        ) : null}
        {shipment.labelUrl ? (
          <a className={btn} href={shipment.labelUrl} target="_blank" rel="noopener noreferrer" data-testid="open-label">
            فتح البوليصة
          </a>
        ) : null}
        {canSchedulePickup(s) || rescheduleMode ? (
          <button className={`${btn} ${canSchedulePickup(s) && s === 'LABEL_CREATED' ? 'btn-primary' : ''}`} onClick={() => setDialog('pickup')} data-testid="schedule-pickup">
            {s === 'LABEL_CREATED' ? 'جدولة الاستلام' : 'إعادة جدولة الاستلام'}
          </button>
        ) : null}
        {!compact && manual.length ? (
          <button className={btn} onClick={() => (setEvStatus(manual[0]), setEvDesc(''), setEvLoc(''), setDialog('event'))}>
            تسجيل حدث يدوي
          </button>
        ) : null}
      </div>
      {scans.length ? (
        <div className="row gap-sm wrap" aria-label="محاكاة الناقل">
          <SandboxTag />
          {scans.map((to) => (
            <button key={to} className="btn btn-sm btn-sandbox" disabled={!!pending} onClick={() => simulate(to)} data-testid={`sim-${to}`}>
              {statusLabel('shipment', to)}
            </button>
          ))}
        </div>
      ) : null}

      <Dialog open={dialog === 'pickup'} onClose={() => setDialog(null)} title={rescheduleMode ? 'إعادة جدولة الاستلام' : 'جدولة استلام من موقع التاجر'} submitLabel="حجز الموعد" pending={pending === 'pickup'} onSubmit={schedule}>
        {rescheduleMode ? <div className="alert alert-warning">انقضت نافذة الاستلام السابقة. سيُسجّل «فشل الاستلام» أولاً ثم يُحجز الموعد الجديد.</div> : null}
        {shipment.trackingNumber ? (
          <p className="muted">
            رقم التتبع: <Mono>{shipment.trackingNumber}</Mono>
          </p>
        ) : null}
        <PickupWindowFields value={win} onChange={setWin} />
      </Dialog>

      <Dialog open={dialog === 'event'} onClose={() => setDialog(null)} title="تسجيل حدث تتبع يدوي" submitLabel="تسجيل" pending={pending === 'event'} onSubmit={recordEvent}>
        <p className="muted">مثلاً بعد تأكيد هاتفي من الناقل. يُسجّل بمصدر «العمليات» ويطبّق كل الآثار (حالة الطلب، الإشعارات).</p>
        <Field label="الحالة الجديدة">
          <select value={evStatus} onChange={(e) => setEvStatus(e.target.value as ShipmentStatus)} required>
            {manual.map((m) => (
              <option key={m} value={m}>
                {statusLabel('shipment', m)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="الوصف">
          <input required minLength={2} maxLength={300} value={evDesc} onChange={(e) => setEvDesc(e.target.value)} />
        </Field>
        <Field label="الموقع — اختياري">
          <input maxLength={120} value={evLoc} onChange={(e) => setEvLoc(e.target.value)} />
        </Field>
      </Dialog>
    </div>
  );
}
