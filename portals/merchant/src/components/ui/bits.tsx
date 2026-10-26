"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";

import { ApiError } from "@/lib/api";

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-brand">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "accent" | "teal";

const TONES: Record<Tone, string> = {
  neutral: "",
  brand: "!bg-brand-50 !text-brand !border-brand-50",
  success: "!bg-success-soft !text-success !border-success-soft",
  warning: "!bg-warning-soft !text-warning-text !border-warning-soft",
  danger: "!bg-danger-soft !text-danger !border-danger-soft",
  accent: "!bg-accent-soft !text-accent-text !border-accent-soft",
  teal: "!bg-teal-soft !text-teal !border-teal-soft",
};

export function Badge({ tone = "neutral", children, className = "" }: { tone?: Tone; children: ReactNode; className?: string }) {
  return <span className={`badge ${TONES[tone]} ${className}`}>{children}</span>;
}

const ORDER_TONE: Record<string, Tone> = {
  NEW: "accent",
  ACCEPTED: "brand",
  PACKING: "brand",
  READY_FOR_PICKUP: "teal",
  HANDED_OVER: "teal",
  DELIVERED: "success",
  REJECTED: "danger",
  CANCELLED: "neutral",
  ACTIVE: "success",
  PAUSED: "warning",
  ARCHIVED: "neutral",
  APPROVED: "success",
  UNDER_REVIEW: "warning",
  APPLIED: "warning",
  SUSPENDED: "danger",
  REQUESTED: "accent",
  RECEIVED: "brand",
  IN_TRANSIT: "teal",
  REFUNDED: "success",
  CLOSED: "neutral",
  PENDING: "warning",
  DRAFT: "neutral",
  PAID: "success",
  LABEL_CREATED: "brand",
  PICKUP_SCHEDULED: "brand",
  PICKED_UP: "teal",
  OUT_FOR_DELIVERY: "teal",
  DELIVERY_FAILED: "danger",
  PICKUP_FAILED: "danger",
  EXCEPTION: "danger",
  DISABLED: "neutral",
};

export function StatusBadge({ status, labels }: { status: string; labels: Record<string, string> }) {
  return <Badge tone={ORDER_TONE[status] ?? "neutral"}>{labels[status] ?? status}</Badge>;
}

/** Marks simulated things (sandbox labels, SBX tracking numbers, sandbox carriers). */
export function SandboxBadge() {
  return (
    <span className="badge !border-warning-soft !bg-warning-soft !text-warning-text" title="بيانات تجريبية — ليست شحنة حقيقية">
      بيئة تجريبية / Sandbox
    </span>
  );
}

export const isSandboxTracking = (tracking: string | null | undefined) => !!tracking && tracking.toUpperCase().startsWith("SBX");

export function Spinner({ label = "جارٍ التحميل…" }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 py-6 text-sm text-slate">
      <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="card flex flex-col items-center gap-2 px-6 py-10 text-center">
      <p className="font-semibold text-ink">{title}</p>
      {body && <p className="max-w-md text-sm text-slate">{body}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/** Inline error with Arabic copy, the API's own (English) message, and field details. */
export function ErrorNote({ error, className = "" }: { error: unknown; className?: string }) {
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  return (
    <div role="alert" className={`rounded-lg border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-danger ${className}`}>
      <p className="font-semibold">{e ? e.messageAr : "حدث خطأ غير متوقع."}</p>
      {e && e.serverMessage && e.code !== "NETWORK" && (
        <p className="ltr mt-0.5 text-xs opacity-80" lang="en">
          {e.code}: {e.serverMessage}
        </p>
      )}
      {e && e.fieldIssues.length > 0 && (
        <ul className="ltr mt-1 list-disc ps-5 text-xs" lang="en">
          {e.fieldIssues.slice(0, 6).map((i) => (
            <li key={i.path + i.message}>
              {i.path}: {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Full-panel message for 403s and pages the role cannot use. */
export function Forbidden({ message }: { message?: string }) {
  return (
    <div className="card mx-auto max-w-lg px-6 py-10 text-center" data-testid="forbidden">
      <p className="text-lg font-bold text-brand">لا تملك صلاحية الوصول</p>
      <p className="mt-2 text-sm text-slate">{message ?? "هذه الصفحة متاحة لأدوار أعلى في متجرك. تواصل مع مالك المتجر إذا كنت تحتاج إليها."}</p>
      <Link href="/" className="btn btn-secondary mt-4">
        العودة إلى الرئيسية
      </Link>
    </div>
  );
}

/** Handles the loading / 403 / error states of a useApi result in one place. */
export function LoadState({ loading, error, onRetry }: { loading: boolean; error?: ApiError; onRetry?: () => void }) {
  if (error?.status === 403) return <Forbidden message="ليست لديك صلاحية لعرض هذه البيانات." />;
  if (error)
    return (
      <div className="space-y-2">
        <ErrorNote error={error} />
        {onRetry && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={onRetry}>
            إعادة المحاولة
          </button>
        )}
      </div>
    );
  if (loading) return <Spinner />;
  return null;
}

export function Field({
  label,
  hint,
  error,
  children,
  className = "",
  required,
}: {
  label: string;
  hint?: ReactNode;
  error?: string;
  children: (props: { id: string; "aria-invalid"?: boolean; "aria-describedby"?: string }) => ReactNode;
  className?: string;
  required?: boolean;
}) {
  const id = useId();
  const describedBy = [hint ? `${id}-hint` : "", error ? `${id}-err` : ""].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="label">
        {label}
        {required && (
          <span className="text-danger" aria-hidden>
            {" "}
            *
          </span>
        )}
      </label>
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy })}
      {hint && !error && (
        <p id={`${id}-hint`} className="hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-err`} className="field-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function Pager({ offset, total, pageSize = 50, onChange }: { offset: number; total: number; pageSize?: number; onChange: (offset: number) => void }) {
  const from = total ? offset + 1 : 0;
  const to = Math.min(offset + pageSize, total);
  return (
    <nav aria-label="التنقل بين الصفحات" className="mt-4 flex items-center justify-center gap-3 text-sm">
      <button type="button" className="btn btn-secondary btn-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - pageSize))}>
        السابق
      </button>
      <span className="text-slate">
        {from}–{to} من {total}
      </span>
      <button type="button" className="btn btn-secondary btn-sm" disabled={to >= total} onClick={() => onChange(offset + pageSize)}>
        التالي
      </button>
    </nav>
  );
}

export function Stat({ label, value, href, tone, hint, testId }: { label: string; value: ReactNode; href?: string; tone?: "accent" | "danger" | "default"; hint?: ReactNode; testId?: string }) {
  const body = (
    <>
      <p className="text-sm text-slate">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${tone === "accent" ? "text-accent-text" : tone === "danger" ? "text-danger" : "text-ink"}`} data-testid={testId}>
        {value}
      </p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </>
  );
  if (href)
    return (
      <Link href={href} className="card block p-4 transition-colors hover:border-brand-600">
        {body}
      </Link>
    );
  return <div className="card p-4">{body}</div>;
}
