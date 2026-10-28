'use client';

import { useState } from 'react';

import { RequireRole } from '@/components/AppShell';
import { useToast } from '@/components/Toasts';
import { Async, Card, Chip, Dialog, Field, PageHead } from '@/components/ui';
import { api, post, qs } from '@/lib/api';
import { formatDate, riyadhToIso } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { bpsLabel, CHANNEL_LABEL, CONDITION_LABEL, ORIGIN_LABEL, RATE_SOURCE_LABEL } from '@/lib/labels';
import type { CommissionRule, Merchant, RatePreview } from '@/lib/types';

type Reference = { categories: { id: string; name: { ar: string; en: string } }[] };
type Draft = {
  id?: string;
  name: string;
  merchantId: string;
  categoryId: string;
  origin: string;
  condition: string;
  channel: 'B2C' | 'B2B' | 'ANY';
  bps: string;
  priority: string;
  validFrom: string;
  validTo: string;
  note: string;
  active: boolean;
};

const EMPTY: Draft = { name: '', merchantId: '', categoryId: '', origin: '', condition: '', channel: 'B2C', bps: '', priority: '0', validFrom: '', validTo: '', note: '', active: true };
const dateOnly = (iso: string | null) => (iso ? iso.slice(0, 10) : '');

export function CommissionRulesView() {
  return (
    <RequireRole role="FINANCE">
      <Rules />
    </RequireRole>
  );
}

function Rules() {
  const state = useApi<{ rules: CommissionRule[]; defaultBps: number }>('v1/ops/commission-rules');
  const ref = useApi<Reference>('v1/catalog/reference');
  const merchants = useApi<{ items: Merchant[] }>(`v1/ops/merchants${qs({ status: 'APPROVED', limit: 100 })}`);
  const { run, pending } = useAction();
  const { push } = useToast();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [preview, setPreview] = useState({ merchantId: '', categoryId: '', origin: 'AFTERMARKET', condition: 'NEW', channel: 'B2C' });
  const [previewResult, setPreviewResult] = useState<RatePreview | null>(null);

  const categoryName = (id: string | null) => (id ? (ref.data?.categories.find((c) => c.id === id)?.name.ar ?? id) : null);
  const set = (patch: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...patch } : d));

  async function save() {
    if (!draft) return;
    const bps = Number(draft.bps);
    if (!Number.isInteger(bps) || bps < 0 || bps > 5000) return push({ tone: 'danger', title: 'النسبة بنقاط الأساس: عدد صحيح بين 0 و5000 (1000 = 10%)' });
    if (draft.name.trim().length < 2) return push({ tone: 'danger', title: 'اكتب اسماً للقاعدة' });
    const body = {
      name: draft.name.trim(),
      merchantId: draft.merchantId || null,
      categoryId: draft.categoryId || null,
      origin: draft.origin || null,
      condition: draft.condition || null,
      channel: draft.channel,
      bps,
      priority: Number(draft.priority) || 0,
      active: draft.active,
      validFrom: draft.validFrom ? riyadhToIso(draft.validFrom, '00:00') : null,
      validTo: draft.validTo ? riyadhToIso(draft.validTo, '23:59') : null,
      note: draft.note.trim() || null,
    };
    const r = await run('save', () => (draft.id ? api(`v1/ops/commission-rules/${draft.id}`, { method: 'PATCH', body }) : post('v1/ops/commission-rules', body)), draft.id ? 'حُدّثت القاعدة' : 'أُضيفت القاعدة');
    if (r) {
      setDraft(null);
      state.reload();
    }
  }

  async function toggle(rule: CommissionRule) {
    await run('toggle', () => api(`v1/ops/commission-rules/${rule.id}`, { method: 'PATCH', body: { active: !rule.active } }), rule.active ? 'أُوقفت القاعدة' : 'فُعّلت القاعدة');
    state.reload();
  }

  async function runPreview() {
    if (!preview.merchantId || !preview.categoryId) return push({ tone: 'danger', title: 'اختر التاجر والفئة' });
    const r = await run('preview', () => api<RatePreview>(`v1/ops/commission-rules/preview${qs(preview)}`));
    if (r) setPreviewResult(r);
  }

  const edit = (r: CommissionRule) =>
    setDraft({
      id: r.id,
      name: r.name,
      merchantId: r.merchantId ?? '',
      categoryId: r.categoryId ?? '',
      origin: r.origin ?? '',
      condition: r.condition ?? '',
      channel: r.channel,
      bps: String(r.bps),
      priority: String(r.priority),
      validFrom: dateOnly(r.validFrom),
      validTo: dateOnly(r.validTo),
      note: r.note ?? '',
      active: r.active,
    });

  return (
    <>
      <PageHead
        title="قواعد العمولة"
        sub="تُحسب العمولة لكل قطعة في الطلب. القاعدة الأكثر تحديداً تفوز (التاجر > الفئة > الأصل > الحالة > القناة)، ثم الأولوية. نسبة التاجر المتفق عليها تتقدم على قواعد المنصة العامة لطلبات الأفراد، ثم النسبة الافتراضية."
        actions={
          <button className="btn btn-primary" onClick={() => setDraft({ ...EMPTY })} data-testid="add-rule">
            إضافة قاعدة
          </button>
        }
      />
      <div className="stack">
        <Card title="القواعد" flush>
          <Async state={state}>
            {(d) => (
              <div className="table-wrap">
                <table className="t" data-testid="rules-table">
                  <thead>
                    <tr>
                      <th>القاعدة</th>
                      <th>التاجر</th>
                      <th>الفئة</th>
                      <th>الأصل</th>
                      <th>الحالة</th>
                      <th>القناة</th>
                      <th className="end">النسبة</th>
                      <th className="end">الأولوية</th>
                      <th>الصلاحية</th>
                      <th>الوضع</th>
                      <th>الإجراء</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rules.map((r) => (
                      <tr key={r.id} style={r.active ? undefined : { opacity: 0.55 }}>
                        <td>
                          {r.name}
                          {r.note ? <div className="cell-sub">{r.note}</div> : null}
                        </td>
                        <td>{r.merchantNameAr ?? <span className="muted">كل التجار</span>}</td>
                        <td>{categoryName(r.categoryId) ?? <span className="muted">الكل</span>}</td>
                        <td>{r.origin ? ORIGIN_LABEL[r.origin] : <span className="muted">الكل</span>}</td>
                        <td>{r.condition ? CONDITION_LABEL[r.condition] : <span className="muted">الكل</span>}</td>
                        <td>{CHANNEL_LABEL[r.channel]}</td>
                        <td className="end">
                          <strong className="num">{bpsLabel(r.bps)}</strong>
                        </td>
                        <td className="end num">{r.priority}</td>
                        <td className="small">
                          {r.validFrom || r.validTo ? (
                            <>
                              {r.validFrom ? `من ${formatDate(r.validFrom)}` : ''} {r.validTo ? `حتى ${formatDate(r.validTo)}` : ''}
                            </>
                          ) : (
                            <span className="muted">دائمة</span>
                          )}
                        </td>
                        <td>{r.active ? <Chip tone="success">مفعّلة</Chip> : <Chip>موقوفة</Chip>}</td>
                        <td>
                          <div className="row gap-sm">
                            <button className="btn btn-sm" onClick={() => edit(r)}>
                              تعديل
                            </button>
                            <button className="btn btn-sm" onClick={() => toggle(r)} disabled={pending === 'toggle'}>
                              {r.active ? 'إيقاف' : 'تفعيل'}
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="muted small" style={{ padding: '8px 16px' }}>
                  النسبة الافتراضية للمنصة عند عدم انطباق أي قاعدة: {bpsLabel(d.defaultBps)}.
                </p>
              </div>
            )}
          </Async>
        </Card>

        <Card title="معاينة: ما النسبة التي تنطبق؟">
          <div className="row gap-sm wrap" style={{ alignItems: 'flex-end' }}>
            <Field label="التاجر">
              <select value={preview.merchantId} onChange={(e) => setPreview({ ...preview, merchantId: e.target.value })}>
                <option value="">—</option>
                {merchants.data?.items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayNameAr}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الفئة">
              <select value={preview.categoryId} onChange={(e) => setPreview({ ...preview, categoryId: e.target.value })}>
                <option value="">—</option>
                {ref.data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الأصل">
              <select value={preview.origin} onChange={(e) => setPreview({ ...preview, origin: e.target.value })}>
                <option value="OEM">أصلي</option>
                <option value="AFTERMARKET">تجاري</option>
              </select>
            </Field>
            <Field label="الحالة">
              <select value={preview.condition} onChange={(e) => setPreview({ ...preview, condition: e.target.value })}>
                <option value="NEW">جديد</option>
                <option value="USED">مستعمل</option>
                <option value="REFURBISHED">مُجدَّد</option>
              </select>
            </Field>
            <Field label="القناة">
              <select value={preview.channel} onChange={(e) => setPreview({ ...preview, channel: e.target.value })}>
                <option value="B2C">أفراد (B2C)</option>
                <option value="B2B">ورش (B2B)</option>
              </select>
            </Field>
            <button className="btn" onClick={runPreview} disabled={pending === 'preview'}>
              احسب
            </button>
          </div>
          {previewResult ? (
            <p style={{ marginBlockStart: 12 }} data-testid="rate-preview">
              النسبة: <strong className="num">{bpsLabel(previewResult.bps)}</strong> — المصدر: {RATE_SOURCE_LABEL[previewResult.source]}
              {previewResult.ruleId ? ` (${state.data?.rules.find((r) => r.id === previewResult.ruleId)?.name ?? previewResult.ruleId})` : ''}
            </p>
          ) : null}
        </Card>
      </div>

      <Dialog open={!!draft} onClose={() => setDraft(null)} title={draft?.id ? 'تعديل قاعدة عمولة' : 'قاعدة عمولة جديدة'} submitLabel="حفظ" pending={pending === 'save'} onSubmit={save} wide>
        {draft ? (
          <div className="grid grid-2">
            <Field label="الاسم">
              <input required value={draft.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} name="name" />
            </Field>
            <Field label="النسبة (نقاط أساس)" hint={`1000 = 10%. الحالية: ${draft.bps ? bpsLabel(Number(draft.bps)) : '—'}`}>
              <input required inputMode="numeric" dir="ltr" value={draft.bps} onChange={(e) => set({ bps: e.target.value })} name="bps" />
            </Field>
            <Field label="التاجر" hint="اتركه فارغاً لكل التجار">
              <select value={draft.merchantId} onChange={(e) => set({ merchantId: e.target.value })} name="merchantId">
                <option value="">كل التجار</option>
                {merchants.data?.items.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayNameAr}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الفئة">
              <select value={draft.categoryId} onChange={(e) => set({ categoryId: e.target.value })} name="categoryId">
                <option value="">كل الفئات</option>
                {ref.data?.categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name.ar}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="الأصل">
              <select value={draft.origin} onChange={(e) => set({ origin: e.target.value })}>
                <option value="">الكل</option>
                <option value="OEM">أصلي</option>
                <option value="AFTERMARKET">تجاري</option>
              </select>
            </Field>
            <Field label="الحالة">
              <select value={draft.condition} onChange={(e) => set({ condition: e.target.value })}>
                <option value="">الكل</option>
                <option value="NEW">جديد</option>
                <option value="USED">مستعمل</option>
                <option value="REFURBISHED">مُجدَّد</option>
              </select>
            </Field>
            <Field label="القناة">
              <select value={draft.channel} onChange={(e) => set({ channel: e.target.value as Draft['channel'] })}>
                <option value="B2C">أفراد (B2C)</option>
                <option value="B2B">ورش (B2B)</option>
                <option value="ANY">الكل</option>
              </select>
            </Field>
            <Field label="الأولوية" hint="تكسر التعادل بين قاعدتين بنفس التحديد">
              <input inputMode="numeric" dir="ltr" value={draft.priority} onChange={(e) => set({ priority: e.target.value })} />
            </Field>
            <Field label="تبدأ من (اختياري)">
              <input type="date" value={draft.validFrom} onChange={(e) => set({ validFrom: e.target.value })} />
            </Field>
            <Field label="تنتهي في (اختياري)" hint="مثل عمولة مخفّضة 90 يوماً للتجار الجدد">
              <input type="date" value={draft.validTo} onChange={(e) => set({ validTo: e.target.value })} />
            </Field>
            <Field label="ملاحظة">
              <input value={draft.note} onChange={(e) => set({ note: e.target.value })} maxLength={500} />
            </Field>
            <label className="check">
              <input type="checkbox" checked={draft.active} onChange={(e) => set({ active: e.target.checked })} /> مفعّلة
            </label>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
