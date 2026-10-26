'use client';

import { useState } from 'react';

import { RequireRole } from '@/components/AppShell';
import { Async, Card, DateTime, Empty, Field, Mono, PageHead } from '@/components/ui';
import { post } from '@/lib/api';
import { shortId } from '@/lib/format';
import { useAction, useApi } from '@/lib/hooks';
import { ROLE_LABEL } from '@/lib/labels';
import type { AuditEvent, PlatformRole } from '@/lib/types';

const ROLES: PlatformRole[] = ['OPS_AGENT', 'FINANCE', 'OPS_ADMIN'];
const ROLE_HINT: Record<PlatformRole, string> = {
  OPS_AGENT: 'برج التحكم، الطلبات، المرتجعات، الإجراءات نيابةً عن التاجر',
  FINANCE: 'التسويات، الاستردادات، سجل الدفع',
  OPS_ADMIN: 'كل الصلاحيات + اعتماد التجار وإدارة الفريق',
};

export function StaffView() {
  return (
    <RequireRole role="OPS_ADMIN">
      <Staff />
    </RequireRole>
  );
}

function Staff() {
  const history = useApi<{ events: AuditEvent[] }>('v1/ops/audit?entityType=user&limit=100');
  const { run, pending } = useAction();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [roles, setRoles] = useState<PlatformRole[]>(['OPS_AGENT']);
  const [created, setCreated] = useState<{ id: string; email: string; roles: PlatformRole[] }[]>([]);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!roles.length) return setErr('اختر دوراً واحداً على الأقل');
    if (password && password.length < 12) return setErr('كلمة المرور 12 حرفاً على الأقل');
    setErr(null);
    const r = await run(
      'create',
      () => post<{ id: string; email: string; roles: PlatformRole[] }>('v1/ops/staff', { name: name.trim(), email: email.trim(), roles, ...(password ? { password } : {}) }),
      (u) => `مُنحت الصلاحيات لـ ${u.email}`,
    );
    if (r) {
      setCreated((c) => [r, ...c]);
      setName('');
      setEmail('');
      setPassword('');
      setRoles(['OPS_AGENT']);
      history.reload();
    }
  }

  const grants = (history.data?.events ?? []).filter((a) => a.action === 'ops_staff.granted');

  return (
    <>
      <PageHead title="فريق العمليات" sub="إنشاء حسابات موظفي قطعة ومنح الأدوار" />
      <div className="grid grid-main-side">
        <Card title="إضافة موظف / منح دور">
          <form className="stack-sm" onSubmit={submit}>
            <div className="grid grid-2" style={{ gap: 10 }}>
              <Field label="الاسم">
                <input required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} name="name" />
              </Field>
              <Field label="البريد الإلكتروني">
                <input required type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} name="email" />
              </Field>
            </div>
            <fieldset className="col gap-sm" style={{ border: '1px solid var(--line)', borderRadius: 8, padding: 10 }}>
              <legend className="field-label">الأدوار</legend>
              {ROLES.map((r) => (
                <label key={r} className="check">
                  <input type="checkbox" checked={roles.includes(r)} onChange={(e) => setRoles((cur) => (e.target.checked ? [...cur, r] : cur.filter((x) => x !== r)))} />
                  <strong>{ROLE_LABEL[r]}</strong> <span className="muted small">— {ROLE_HINT[r]}</span>
                </label>
              ))}
            </fieldset>
            <Field label="كلمة مرور أولية" hint="مطلوبة في وضع الدخول المحلي (12 حرفاً على الأقل). مع Cognito اتركها فارغة: يُربط الحساب بالبريد عند أول دخول. إن كان البريد موجوداً تُضاف الأدوار فقط.">
              <input type="password" autoComplete="new-password" dir="ltr" minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} name="password" />
            </Field>
            {err ? <div className="alert alert-danger">{err}</div> : null}
            <div>
              <button className="btn btn-primary" type="submit" disabled={pending === 'create'}>
                {pending === 'create' ? 'جارٍ الحفظ…' : 'منح الصلاحيات'}
              </button>
            </div>
          </form>
          {created.length ? (
            <div className="alert alert-success" style={{ marginBlockStart: 12, display: 'block' }}>
              {created.map((c) => (
                <div key={c.id}>
                  {c.email}: {c.roles.map((r) => ROLE_LABEL[r]).join('، ')}
                </div>
              ))}
            </div>
          ) : null}
        </Card>
        <Card title="سجل منح الصلاحيات" flush>
          <p className="notice" style={{ margin: 12 }}>
            لا يوفّر الخادم بعد قائمة بالموظفين الحاليين؛ يُعرض هنا سجل المنح من سجل التدقيق.
          </p>
          <Async state={history}>
            {() =>
              grants.length ? (
                <ul className="feed" style={{ padding: '0 16px' }}>
                  {grants.map((g) => (
                    <li key={g.id}>
                      <span>
                        <Mono>{shortId(g.entityId)}</Mono> ← {((g.data as { roles?: string[] })?.roles ?? []).map((r) => ROLE_LABEL[r] ?? r).join('، ')}
                      </span>
                      <DateTime iso={g.createdAt} ago />
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>لا يوجد سجل منح</Empty>
              )
            }
          </Async>
        </Card>
      </div>
    </>
  );
}
