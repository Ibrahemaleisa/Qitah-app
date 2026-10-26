'use client';

import Link from 'next/link';
import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

type Toast = { id: number; tone: 'success' | 'danger' | 'info' | 'warning'; title: string; body?: string; href?: string };
type Ctx = { push: (t: Omit<Toast, 'id'>) => void };

const ToastCtx = createContext<Ctx>({ push: () => undefined });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const dismiss = useCallback((id: number) => setToasts((ts) => ts.filter((t) => t.id !== id)), []);
  const push = useCallback(
    (t: Omit<Toast, 'id'>) => {
      const id = ++seq.current;
      setToasts((ts) => [...ts.slice(-4), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === 'danger' ? 9000 : 5000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ push }), [push]);
  return (
    <ToastCtx.Provider value={value}>
      {children}
      <div className="toasts" role="region" aria-label="التنبيهات" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.tone}`} role={t.tone === 'danger' ? 'alert' : 'status'}>
            <div className="toast-text">
              <strong>{t.title}</strong>
              {t.body ? <span>{t.body}</span> : null}
              {t.href ? (
                <Link href={t.href} onClick={() => dismiss(t.id)}>
                  فتح
                </Link>
              ) : null}
            </div>
            <button type="button" className="icon-btn" aria-label="إغلاق" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
