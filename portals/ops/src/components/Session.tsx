'use client';

import { createContext, useContext, useEffect, useState } from 'react';

import { api } from '@/lib/api';
import { errorMessage } from '@/lib/errors';
import type { Me, PlatformRole, Summary } from '@/lib/types';

type SessionState = {
  me: Me;
  /** OPS_ADMIN implies every platform role (same rule as the API). */
  has: (role: PlatformRole) => boolean;
  isAdmin: boolean;
  sandbox: boolean;
};

const SessionCtx = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const s = useContext(SessionCtx);
  if (!s) throw new Error('useSession outside SessionProvider');
  return s;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => undefined);
  window.location.assign(new URL('/login', window.location.origin).href);
}

export function SessionGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{ me?: Me; sandbox: boolean; error?: string }>({ sandbox: false });

  useEffect(() => {
    let alive = true;
    api<Me>('v1/me')
      .then(async (me) => {
        let sandbox = false;
        if (me.platformRoles.length) sandbox = (await api<Summary>('v1/ops/summary').catch(() => undefined))?.sandbox ?? false;
        if (alive) setState({ me, sandbox });
      })
      .catch((e) => alive && setState({ sandbox: false, error: errorMessage(e) }));
    return () => {
      alive = false;
    };
  }, []);

  if (state.error) {
    return (
      <div className="center-screen">
        <div className="card narrow">
          <h1 className="h2">تعذر تحميل الجلسة</h1>
          <p className="muted">{state.error}</p>
          <div className="row gap">
            <button className="btn" onClick={() => window.location.reload()}>
              إعادة المحاولة
            </button>
            <button className="btn btn-ghost" onClick={logout}>
              تسجيل الخروج
            </button>
          </div>
        </div>
      </div>
    );
  }
  if (!state.me) {
    return (
      <div className="center-screen" aria-busy="true">
        <div className="spinner" aria-label="جارٍ التحميل" />
      </div>
    );
  }
  if (!state.me.platformRoles.length) return <NoAccess me={state.me} />;

  const roles = state.me.platformRoles;
  const isAdmin = roles.includes('OPS_ADMIN');
  const value: SessionState = { me: state.me, isAdmin, sandbox: state.sandbox, has: (r) => isAdmin || roles.includes(r) };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}

function NoAccess({ me }: { me: Me }) {
  return (
    <main className="center-screen" data-testid="no-access">
      <div className="card narrow">
        <div className="brand-mark" aria-hidden>
          ق
        </div>
        <h1 className="h2">لا تملك صلاحية الوصول</h1>
        <p>
          بوابة العمليات الداخلية مخصصة لفريق قطعة فقط (العمليات، المالية). حسابك <bdi>{me.email ?? me.phone}</bdi> لا يملك دوراً على المنصة.
        </p>
        {me.merchants.length ? <p className="muted">إن كنت تاجراً، استخدم بوابة التجار لإدارة متجرك.</p> : null}
        <p className="muted">إن كنت من فريق قطعة، اطلب من مدير العمليات منحك الصلاحية.</p>
        <button className="btn btn-primary" onClick={logout}>
          تسجيل الخروج
        </button>
      </div>
    </main>
  );
}
