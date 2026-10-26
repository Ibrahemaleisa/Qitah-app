'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';

const MESSAGES: Record<string, string> = {
  UNAUTHENTICATED: 'البريد الإلكتروني أو كلمة المرور غير صحيحة.',
  UPSTREAM_UNAVAILABLE: 'خدمة تسجيل الدخول غير متاحة حالياً.',
  RATE_LIMITED: 'محاولات كثيرة. انتظر دقيقة ثم أعد المحاولة.',
  VALIDATION_FAILED: 'أدخل البريد الإلكتروني وكلمة المرور.',
  CSRF_REJECTED: 'رُفض الطلب. أعد تحميل الصفحة.',
};

/** Only same-site relative paths are accepted as a post-login destination (no open redirect). */
function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login')) return '/';
  return raw;
}

export function LoginForm() {
  const params = useSearchParams();
  const next = safeNext(params.get('next'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const initialError = params.get('error');
  const [error, setError] = useState<string | null>(initialError ? (MESSAGES[initialError] ?? 'تعذر تسجيل الدخول.') : null);
  const [pending, setPending] = useState(false);

  // SameSite=Strict cookies are not sent on cross-site navigations (e.g. a link from chat). If a session
  // exists, this same-origin request carries it and we continue straight to the destination.
  useEffect(() => {
    fetch('/api/proxy/v1/me', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => {
        if (r.ok) window.location.replace(next);
      })
      .catch(() => undefined);
  }, [next]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'same-origin',
      });
      if (res.ok) {
        window.location.assign(next);
        return;
      }
      const body = (await res.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      setError(MESSAGES[body.error?.code ?? ''] ?? body.error?.message ?? 'تعذر تسجيل الدخول.');
    } catch {
      setError('تعذر الاتصال بالخادم.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="card login-card" method="post" action="/api/auth/login" onSubmit={submit} aria-describedby={error ? 'login-error' : undefined}>
      <input type="hidden" name="next" value={next} />
      <div className="login-brand">
        <span className="brand-mark lg" aria-hidden>
          ق
        </span>
        <div>
          <h1 className="h2">بوابة العمليات</h1>
          <p className="muted">للاستخدام الداخلي لفريق قطعة فقط</p>
        </div>
      </div>
      <label className="field">
        <span className="field-label">البريد الإلكتروني</span>
        <input type="email" name="email" autoComplete="username" required dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />
      </label>
      <label className="field">
        <span className="field-label">كلمة المرور</span>
        <input type="password" name="password" autoComplete="current-password" required dir="ltr" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      {error ? (
        <div className="alert alert-danger" id="login-error" role="alert">
          {error}
        </div>
      ) : null}
      <button type="submit" className="btn btn-primary btn-block" disabled={pending}>
        {pending ? 'جارٍ الدخول…' : 'تسجيل الدخول'}
      </button>
    </form>
  );
}
