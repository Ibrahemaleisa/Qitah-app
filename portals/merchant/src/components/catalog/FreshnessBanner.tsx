"use client";

import { useState } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { useToast } from "@/components/ui/Toast";
import { api, errorText } from "@/lib/api";
import { formatInt, percent } from "@/lib/format";
import type { FreshnessSummary } from "@/lib/types";
import { useApi } from "@/lib/useApi";

/**
 * "Is your stock still accurate?" — offer freshness summary with the one-click confirmation.
 * Offers not confirmed for `staleDays` rank lower for customers; after `hideDays` they are hidden until reconfirmed.
 */
export function FreshnessBanner({ onConfirmed }: { onConfirmed?: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const summary = useApi<FreshnessSummary>(m.can("stock") ? `${m.base}/offers/freshness` : null, { refreshOn: ["offer"] });
  const [busy, setBusy] = useState(false);
  const s = summary.data;
  if (!s || s.active === 0) return null;
  const attention = s.stale + s.hidden;
  const tone = s.hidden > 0 ? "border-danger/30 bg-danger-soft" : attention > 0 || s.staleWithin48h > 0 ? "border-warning/30 bg-warning-soft" : "border-success/30 bg-success-soft";

  async function confirmAll() {
    setBusy(true);
    try {
      const r = await api<{ confirmed: number }>(`${m.base}/offers/confirm`, { method: "POST", body: {} });
      toast({ tone: "success", title: "تم تأكيد المخزون", body: `أُكِّد ${formatInt(r.confirmed)} عرضاً. شكراً لحرصك على دقة المخزون.` });
      summary.reload();
      onConfirmed?.();
    } catch (e) {
      toast({ tone: "error", title: "تعذر التأكيد", body: errorText(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={`mb-4 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm ${tone}`} data-testid="freshness-banner">
      <div className="min-w-[16rem] flex-1">
        <p className="font-semibold text-ink">
          دقة المخزون: {percent(s.freshnessRate)} من عروضك مؤكدة خلال آخر {s.staleDays} أيام
        </p>
        <p className="mt-0.5 text-slate">
          {attention > 0
            ? `${formatInt(s.stale)} عرضاً بحاجة لتأكيد (تظهر بعد العروض المؤكدة)${s.hidden ? `، و${formatInt(s.hidden)} مخفية عن العملاء منذ أكثر من ${s.hideDays} يوماً` : ""}.`
            : s.staleWithin48h > 0
              ? `${formatInt(s.staleWithin48h)} عرضاً ستحتاج تأكيداً خلال يومين.`
              : "كل عروضك مؤكدة. أي تحديث للكمية أو السعر يُعدّ تأكيداً تلقائياً."}{" "}
          رفض الطلب بسبب نفاد المخزون يضر بثقة العملاء وبترتيب عروضك.
        </p>
      </div>
      <button type="button" className="btn btn-primary btn-sm" onClick={confirmAll} disabled={busy} data-testid="confirm-stock">
        {busy ? "…" : "مخزوني دقيق — أكّد كل العروض"}
      </button>
    </section>
  );
}
