"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

type Tone = "info" | "success" | "error";
type Toast = { id: number; title: string; body?: string; tone: Tone; href?: string };

const ToastContext = createContext<{ show: (t: Omit<Toast, "id">) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: number) => setToasts((all) => all.filter((t) => t.id !== id)), []);
  const show = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = ++seq.current;
      setToasts((all) => [...all.slice(-3), { ...t, id }]);
      setTimeout(() => dismiss(id), t.tone === "error" ? 9000 : 6000);
    },
    [dismiss],
  );
  const value = useMemo(() => ({ show }), [show]);

  const toneClass: Record<Tone, string> = {
    info: "border-s-brand",
    success: "border-s-success",
    error: "border-s-danger",
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div aria-live="polite" role="status" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pe-6">
        {toasts.map((t) => (
          <div key={t.id} data-testid="toast" className={`card pointer-events-auto w-full max-w-sm border-s-4 p-3 shadow-lg ${toneClass[t.tone]}`}>
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold">{t.title}</p>
                {t.body && <p className="text-sm text-slate">{t.body}</p>}
                {t.href && (
                  <a href={t.href} className="mt-1 inline-block text-sm font-semibold text-brand underline">
                    عرض
                  </a>
                )}
              </div>
              <button type="button" onClick={() => dismiss(t.id)} className="btn btn-ghost btn-sm" aria-label="إغلاق التنبيه">
                ✕
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast outside ToastProvider");
  return ctx.show;
}
