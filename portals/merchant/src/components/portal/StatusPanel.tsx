"use client";

import Link from "next/link";

import { MERCHANT_STATUS_AR } from "@/lib/labels";

import { useMerchant } from "./MerchantContext";

const COPY: Record<string, { title: string; body: string }> = {
  APPLIED: { title: "استلمنا طلب انضمامك", body: "سيبدأ فريق قطعة مراجعة بيانات متجرك قريباً." },
  UNDER_REVIEW: {
    title: "طلبك قيد المراجعة",
    body: "يتحقق فريق قطعة من السجل التجاري وبيانات المتجر. سنرسل لك إشعاراً عند الاعتماد. يمكنك خلال ذلك تجهيز فروعك وإرسال مستندات التحقق.",
  },
  REJECTED: { title: "لم يتم اعتماد طلبك", body: "راجع سبب الرفض أدناه، ثم أرسل مستندات محدّثة لإعادة المراجعة." },
  SUSPENDED: { title: "متجرك موقوف مؤقتاً", body: "عروضك مخفية عن العملاء ولا يمكن استقبال طلبات جديدة. تواصل مع فريق قطعة لمعالجة السبب." },
};

/** Shown instead of the dashboard (and at the top of the store page) until the store is approved. */
export function StatusPanel() {
  const m = useMerchant();
  if (m.status === "APPROVED") return null;
  const copy = COPY[m.status] ?? COPY.UNDER_REVIEW;
  const danger = m.status === "REJECTED" || m.status === "SUSPENDED";
  const reason = m.profile?.statusReason;
  return (
    <section className={`card border-s-4 p-6 ${danger ? "border-s-danger" : "border-s-warning"}`} data-testid="status-panel" data-status={m.status}>
      <p className={`text-sm font-semibold ${danger ? "text-danger" : "text-warning-text"}`}>حالة المتجر: {MERCHANT_STATUS_AR[m.status]}</p>
      <h2 className="mt-1 text-xl font-bold text-brand">{copy.title}</h2>
      <p className="mt-2 max-w-2xl text-sm text-slate">{copy.body}</p>
      {reason && (
        <div className="mt-4 rounded-lg bg-mist px-4 py-3 text-sm">
          <p className="font-semibold">سبب القرار</p>
          <p className="mt-0.5">{reason}</p>
        </div>
      )}
      <div className="mt-5 flex flex-wrap gap-2">
        {m.status !== "SUSPENDED" && m.can("verification") && (
          <Link href="/store#verification" className="btn btn-primary">
            إرسال مستندات التحقق
          </Link>
        )}
        {m.can("locations.manage") && (
          <Link href="/locations" className="btn btn-secondary">
            إدارة الفروع
          </Link>
        )}
        <Link href="/store" className="btn btn-ghost">
          بيانات المتجر
        </Link>
      </div>
    </section>
  );
}
