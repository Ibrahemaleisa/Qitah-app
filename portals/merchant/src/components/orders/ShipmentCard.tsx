"use client";

import { isSandboxTracking, SandboxBadge, StatusBadge } from "@/components/ui/bits";
import { formatDateTime, formatTime } from "@/lib/format";
import { SHIPMENT_STATUS_AR } from "@/lib/labels";
import type { Shipment } from "@/lib/types";

/** Only http(s) label links are rendered (the URL comes from the carrier integration). */
function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export function ShipmentCard({ s }: { s: Shipment }) {
  const sandbox = s.sandbox || isSandboxTracking(s.trackingNumber);
  const label = safeUrl(s.labelUrl);
  return (
    <article className="card p-4" data-testid="shipment" data-status={s.status}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">
          {s.direction === "RETURN" ? "شحنة إرجاع" : "شحنة"} · <span className="ltr text-sm text-slate">{s.carrierCode}</span>
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          {sandbox && <SandboxBadge />}
          <StatusBadge status={s.status} labels={SHIPMENT_STATUS_AR} />
        </div>
      </div>
      <dl className="mt-3 grid gap-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate">رقم التتبع</dt>
          {s.trackingNumber ? (
            <dd className="ltr font-mono font-semibold" data-testid="tracking-number">
              {s.trackingNumber}
            </dd>
          ) : (
            <dd className="text-slate" data-testid="tracking-number">
              لم يصدر بعد
            </dd>
          )}
        </div>
        {s.pickupWindowStart && (
          <div className="flex justify-between gap-3">
            <dt className="text-slate">موعد استلام المندوب</dt>
            <dd>
              {formatDateTime(s.pickupWindowStart)}
              {s.pickupWindowEnd ? ` – ${formatTime(s.pickupWindowEnd)}` : ""}
            </dd>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <dt className="text-slate">الوزن</dt>
          <dd>{(s.weightGrams / 1000).toFixed(1)} كجم</dd>
        </div>
        {s.exceptionReason && <p className="rounded bg-danger-soft px-2 py-1 text-danger">{s.exceptionReason}</p>}
      </dl>
      {label && (
        <a href={label} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm mt-3" data-testid="label-link">
          طباعة البوليصة{sandbox ? " (تجريبية)" : ""}
        </a>
      )}
      {s.events.length > 0 && (
        <ol className="mt-4 space-y-2 border-s-2 border-line ps-4 text-sm" aria-label="أحداث التتبع">
          {[...s.events].reverse().map((e) => (
            <li key={e.id} className="relative">
              <span className="absolute -start-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-brand" aria-hidden />
              <p className="font-medium">{SHIPMENT_STATUS_AR[e.status] ?? e.status}</p>
              <p className="text-xs text-slate">
                {formatDateTime(e.occurredAt)}
                {e.location ? ` · ${e.location}` : ""}
              </p>
              {e.description && (
                <p className="ltr text-start text-xs text-muted" lang="en">
                  {e.description}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </article>
  );
}
