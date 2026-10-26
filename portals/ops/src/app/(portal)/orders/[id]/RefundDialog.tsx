'use client';

import { useMemo, useState } from 'react';

import { Dialog, Field, Money } from '@/components/ui';
import { newIdempotencyKey, post } from '@/lib/api';
import { useAction } from '@/lib/hooks';
import { formatSar, parseSarToHalalas } from '@/lib/money';
import type { OrderTrace } from '@/lib/types';

/**
 * Goodwill / partial refund against one merchant suborder (FINANCE).
 * One idempotency key per dialog opening: double-submits and retries cannot refund twice.
 */
export function RefundDialog({ open, onClose, order, onDone }: { open: boolean; onClose: () => void; order: OrderTrace['order']; onDone: () => void }) {
  const { run, pending } = useAction();
  const [key, setKey] = useState('');
  const [moId, setMoId] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Refundable per suborder = items value − PENDING/SUCCEEDED refunds already allocated to it (same rule as the API).
  const refundable = useMemo(() => {
    const used = new Map<string, number>();
    for (const r of order.refunds) {
      if (r.status === 'FAILED') continue;
      for (const a of r.allocation ?? []) used.set(a.merchantOrderId, (used.get(a.merchantOrderId) ?? 0) + a.items);
    }
    return Object.fromEntries(order.merchantOrders.map((m) => [m.id, Math.max(0, m.itemsHalalas - (used.get(m.id) ?? 0))]));
  }, [order]);

  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setKey(newIdempotencyKey());
      setMoId(order.merchantOrders.find((m) => refundable[m.id] > 0)?.id ?? '');
      setAmount('');
      setReason('');
      setError(null);
    }
  }
  const max = moId ? refundable[moId] ?? 0 : 0;

  async function submit() {
    const halalas = parseSarToHalalas(amount);
    if (!moId) return setError('اختر الطلب الفرعي');
    if (halalas === null || halalas <= 0) return setError('أدخل مبلغاً صحيحاً بالريال (حتى خانتين عشريتين)');
    if (halalas > max) return setError(`الحد الأقصى لهذا الطلب الفرعي ${formatSar(max)}`);
    if (reason.trim().length < 3) return setError('اكتب سبباً واضحاً (3 أحرف على الأقل)');
    setError(null);
    const r = await run(
      'refund',
      () => post(`v1/ops/orders/${order.id}/refunds`, { merchantOrderId: moId, amountHalalas: halalas, reason: reason.trim(), idempotencyKey: key }),
      `أُرسل استرداد ${formatSar(halalas)}`,
    );
    if (r) {
      onClose();
      onDone();
    }
  }

  return (
    <Dialog open={open} onClose={onClose} title={`استرداد جزئي / تعويض — ${order.number}`} submitLabel="تنفيذ الاسترداد" pending={pending === 'refund'} onSubmit={submit}>
      <p className="muted small">يُخصم من حصة التاجر (قيمة الأصناف) وتُعكس العمولة بنسبتها. يُرسل لمزود الدفع ويكتمل عند وصول webhook التأكيد.</p>
      <Field label="الطلب الفرعي">
        <select value={moId} onChange={(e) => setMoId(e.target.value)} required name="merchantOrderId">
          {order.merchantOrders.map((m) => (
            <option key={m.id} value={m.id} disabled={refundable[m.id] <= 0}>
              {m.number} — {m.merchant.displayNameAr} (المتاح {formatSar(refundable[m.id])})
            </option>
          ))}
        </select>
      </Field>
      <Field label="المبلغ (ر.س)" hint={<>الحد الأقصى: <Money h={max} /></>}>
        <input inputMode="decimal" dir="ltr" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} required name="amount" />
      </Field>
      <Field label="السبب">
        <textarea required minLength={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} name="reason" />
      </Field>
      {error ? <div className="alert alert-danger" role="alert">{error}</div> : null}
      <p className="field-hint">
        مفتاح عدم التكرار: <span className="mono">{key.slice(0, 8)}…</span>
      </p>
    </Dialog>
  );
}
