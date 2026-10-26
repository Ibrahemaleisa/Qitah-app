"use client";

import { useState } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { Dialog } from "@/components/ui/Dialog";
import { ErrorNote, Field } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, errorText } from "@/lib/api";
import { REJECT_REASONS } from "@/lib/labels";
import type { MerchantOrder } from "@/lib/types";

type Action = "accept" | "pack" | "ready";

const PRIMARY: Partial<Record<MerchantOrder["status"], { action: Action; label: string; done: string }>> = {
  NEW: { action: "accept", label: "قبول الطلب", done: "تم قبول الطلب" },
  ACCEPTED: { action: "pack", label: "بدء التجهيز", done: "بدأ تجهيز الطلب" },
  PACKING: { action: "ready", label: "جاهز للاستلام", done: "الطلب جاهز لاستلام المندوب" },
};

export function OrderActions({ order, onDone, size = "md" }: { order: Pick<MerchantOrder, "id" | "number" | "status">; onDone: () => void; size?: "sm" | "md" }) {
  const m = useMerchant();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [reason, setReason] = useState("OUT_OF_STOCK");
  const [note, setNote] = useState("");
  const [rejectError, setRejectError] = useState<unknown>(null);

  const primary = PRIMARY[order.status];
  const canReject = order.status === "NEW" || order.status === "ACCEPTED";
  if (!primary && !canReject) return null;
  const sm = size === "sm" ? "btn-sm" : "";

  async function run(action: Action, doneText: string) {
    setBusy(action);
    try {
      await api(`${m.base}/orders/${order.id}/${action}`, { method: "POST", body: {} });
      toast({ tone: "success", title: doneText, body: order.number });
      onDone();
    } catch (e) {
      toast({ tone: "error", title: "تعذر تنفيذ الإجراء", body: errorText(e) });
      onDone();
    } finally {
      setBusy(null);
    }
  }

  async function reject() {
    setBusy("reject");
    setRejectError(null);
    try {
      await api(`${m.base}/orders/${order.id}/reject`, { method: "POST", body: { reason, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast({ tone: "success", title: "تم رفض الطلب وإبلاغ العميل", body: order.number });
      setRejectOpen(false);
      onDone();
    } catch (e) {
      setRejectError(e);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {primary && (
        <button type="button" className={`btn btn-primary ${sm}`} disabled={!!busy} onClick={() => run(primary.action, primary.done)} data-testid={`action-${primary.action}`}>
          {busy === primary.action ? "جارٍ التنفيذ…" : primary.label}
        </button>
      )}
      {canReject && (
        <button type="button" className={`btn btn-danger ${sm}`} disabled={!!busy} onClick={() => setRejectOpen(true)} data-testid="action-reject">
          رفض
        </button>
      )}
      <Dialog open={rejectOpen} onClose={() => setRejectOpen(false)} title={`رفض الطلب ${order.number}`}>
        <div className="space-y-4">
          <p className="text-sm text-slate">سيُعاد المخزون المحجوز ويُسترد المبلغ للعميل تلقائياً. الرفض يؤثر على نسبة الرفض في أداء متجرك.</p>
          <Field label="سبب الرفض" required>
            {(p) => (
              <select {...p} className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
                {REJECT_REASONS.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.ar}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="ملاحظة (اختياري)">{(p) => <textarea {...p} className="textarea" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <ErrorNote error={rejectError} />
          <div className="flex justify-end gap-2">
            <button type="button" className="btn btn-secondary" onClick={() => setRejectOpen(false)}>
              تراجع
            </button>
            <button type="button" className="btn btn-danger" disabled={busy === "reject"} onClick={reject} data-testid="confirm-reject">
              {busy === "reject" ? "جارٍ الرفض…" : "تأكيد الرفض"}
            </button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
