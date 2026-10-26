'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

import { formatAgo, formatDateTime } from '@/lib/format';
import { statusLabel, statusTone, type StatusKind, type Tone } from '@/lib/labels';
import { formatSar } from '@/lib/money';

export function Chip({ tone = 'neutral', children, title }: { tone?: Tone; children: React.ReactNode; title?: string }) {
  return (
    <span className={`chip chip-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function StatusChip({ kind, value }: { kind: StatusKind; value: string }) {
  return (
    <span className={`chip chip-${statusTone(kind, value)}`} data-status={value} title={value}>
      {statusLabel(kind, value)}
    </span>
  );
}

export function Money({ h, className }: { h: number; className?: string }) {
  return <bdi className={`num ${className ?? ''} ${h < 0 ? 'neg' : ''}`}>{formatSar(h)}</bdi>;
}

export function DateTime({ iso, ago }: { iso: string | null | undefined; ago?: boolean }) {
  if (!iso) return <span className="muted">—</span>;
  return (
    <time dateTime={iso} title={formatDateTime(iso)} className="num">
      {ago ? formatAgo(iso) : formatDateTime(iso)}
    </time>
  );
}

export function SandboxTag({ children = 'محاكاة — بيئة تجريبية' }: { children?: React.ReactNode }) {
  return <span className="sandbox-tag">{children}</span>;
}

export function Card({ title, actions, children, id, className, flush }: { title?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; id?: string; className?: string; flush?: boolean }) {
  return (
    <section className={`card ${flush ? 'flush' : ''} ${className ?? ''}`} id={id} aria-labelledby={id && title ? `${id}-h` : undefined}>
      {title || actions ? (
        <header className="card-head">
          {title ? (
            <h2 className="h3" id={id ? `${id}-h` : undefined}>
              {title}
            </h2>
          ) : (
            <span />
          )}
          {actions ? <div className="row gap-sm wrap">{actions}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  );
}

export function KV({ items }: { items: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="kv">
      {items.map(([k, v], i) => (
        <div key={i}>
          <dt>{k}</dt>
          <dd>{v ?? <span className="muted">—</span>}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Empty({ children = 'لا توجد بيانات' }: { children?: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-danger" role="alert">
      <span>{error}</span>
      {onRetry ? (
        <button className="btn btn-sm" onClick={onRetry}>
          إعادة المحاولة
        </button>
      ) : null}
    </div>
  );
}

export function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="skeleton-wrap" aria-busy="true" aria-label="جارٍ التحميل">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" />
      ))}
    </div>
  );
}

/** Standard loading / error / content switch for useApi results. */
export function Async<T>({ state, children, rows }: { state: { data?: T; error: string | null; loading: boolean; reload: () => void }; children: (d: T) => React.ReactNode; rows?: number }) {
  if (state.data === undefined) {
    if (state.error) return <ErrorBox error={state.error} onRetry={state.reload} />;
    return <Loading rows={rows} />;
  }
  return (
    <>
      {state.error ? <ErrorBox error={state.error} onRetry={state.reload} /> : null}
      {children(state.data)}
    </>
  );
}

export function PageHead({ title, sub, actions, crumbs }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode; crumbs?: { href: string; label: string }[] }) {
  return (
    <div className="page-head">
      <div className="page-head-text">
        {crumbs?.length ? (
          <nav aria-label="مسار التنقل" className="crumbs">
            {crumbs.map((c) => (
              <Link key={c.href} href={c.href}>
                {c.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <h1 className="h1">{title}</h1>
        {sub ? <div className="muted page-sub">{sub}</div> : null}
      </div>
      {actions ? <div className="row gap-sm wrap">{actions}</div> : null}
    </div>
  );
}

export function SubNav({ items }: { items: { href: string; label: string; count?: number; tone?: Tone }[] }) {
  const path = usePathname();
  return (
    <nav className="subnav" aria-label="أقسام">
      {items.map((i) => {
        const active = path === i.href;
        return (
          <Link key={i.href} href={i.href} className={active ? 'active' : ''} aria-current={active ? 'page' : undefined}>
            {i.label}
            {i.count !== undefined ? <span className={`count ${i.count && i.tone ? `count-${i.tone}` : ''}`}>{i.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

/** Filter pills (single-select). */
export function Pills<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: { value: V; label: string; count?: number }[]; label: string }) {
  return (
    <div className="pills" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? 'pill active' : 'pill'} onClick={() => onChange(o.value)}>
          {o.label}
          {o.count !== undefined ? <span className="count">{o.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Accessible modal built on the native <dialog> element (focus trap + Esc handled by the browser). */
export function Dialog({
  open,
  onClose,
  title,
  children,
  onSubmit,
  submitLabel = 'تأكيد',
  submitTone = 'primary',
  pending,
  wide,
  sandbox,
}: {
  open: boolean;
  onClose: () => void;
  title: React.ReactNode;
  children: React.ReactNode;
  onSubmit: () => void | Promise<void>;
  submitLabel?: string;
  submitTone?: 'primary' | 'danger';
  pending?: boolean;
  wide?: boolean;
  sandbox?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`dialog ${wide ? 'wide' : ''}`} aria-labelledby={titleId} onClose={onClose} onCancel={onClose}>
      {open ? (
        <form
          method="dialog"
          onSubmit={(e) => {
            e.preventDefault();
            if (!pending) void onSubmit();
          }}
        >
          <header className="dialog-head">
            <h2 className="h3" id={titleId}>
              {title}
            </h2>
            {sandbox ? <SandboxTag /> : null}
          </header>
          <div className="dialog-body">{children}</div>
          <footer className="dialog-foot">
            <button type="button" className="btn btn-ghost" onClick={onClose}>
              إلغاء
            </button>
            <button type="submit" className={`btn btn-${submitTone}`} disabled={pending}>
              {pending ? 'جارٍ التنفيذ…' : submitLabel}
            </button>
          </footer>
        </form>
      ) : null}
    </dialog>
  );
}

/** A button that asks for confirmation in a dialog before running `onConfirm`. */
export function ConfirmButton({
  label,
  title,
  message,
  onConfirm,
  tone = 'primary',
  size = 'sm',
  disabled,
  confirmLabel,
  sandbox,
  testId,
}: {
  label: React.ReactNode;
  title: string;
  message: React.ReactNode;
  onConfirm: () => Promise<unknown>;
  tone?: 'primary' | 'danger' | 'default';
  size?: 'sm' | 'md';
  disabled?: boolean;
  confirmLabel?: string;
  sandbox?: boolean;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  return (
    <>
      <button type="button" className={`btn ${size === 'sm' ? 'btn-sm' : ''} ${tone === 'default' ? '' : `btn-${tone}`}`} disabled={disabled} onClick={() => setOpen(true)} data-testid={testId}>
        {label}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        submitLabel={confirmLabel ?? (typeof label === 'string' ? label : 'تأكيد')}
        submitTone={tone === 'danger' ? 'danger' : 'primary'}
        pending={pending}
        sandbox={sandbox}
        onSubmit={async () => {
          setPending(true);
          try {
            await onConfirm();
          } finally {
            setPending(false);
            setOpen(false);
          }
        }}
      >
        <p>{message}</p>
      </Dialog>
    </>
  );
}

export function Field({ label, hint, children, error }: { label: string; hint?: React.ReactNode; children: React.ReactNode; error?: string | null }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
      {error ? <span className="field-error">{error}</span> : null}
    </label>
  );
}

export function Pager({ total, offset, limit, onChange }: { total: number; offset: number; limit: number; onChange: (offset: number) => void }) {
  if (total <= limit && offset === 0) return <div className="pager muted">{total} سجل</div>;
  return (
    <div className="pager">
      <span className="muted num">
        {offset + 1}–{Math.min(offset + limit, total)} من {total}
      </span>
      <button className="btn btn-sm" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - limit))}>
        السابق
      </button>
      <button className="btn btn-sm" disabled={offset + limit >= total} onClick={() => onChange(offset + limit)}>
        التالي
      </button>
    </div>
  );
}

export function JsonDetails({ value, summary = 'التفاصيل' }: { value: unknown; summary?: string }) {
  if (value === null || value === undefined || (typeof value === 'object' && Object.keys(value as object).length === 0)) return <span className="muted">—</span>;
  return (
    <details className="json">
      <summary>{summary}</summary>
      <pre dir="ltr">{JSON.stringify(value, null, 2)}</pre>
    </details>
  );
}

export function Mono({ children }: { children: React.ReactNode }) {
  return (
    <bdi className="mono" dir="ltr">
      {children}
    </bdi>
  );
}
