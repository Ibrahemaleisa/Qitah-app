"use client";

import { useState } from "react";

import { VerificationForm } from "@/components/portal/VerificationForm";
import { useMerchant } from "@/components/portal/MerchantContext";
import { StatusPanel } from "@/components/portal/StatusPanel";
import { Badge, LoadState, PageHeader, StatusBadge } from "@/components/ui/bits";
import { api, errorText } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/format";
import { cityAr, DOCUMENT_TYPE_AR, label, MERCHANT_STATUS_AR, ROLE_AR, VERIFICATION_STATUS_AR } from "@/lib/labels";

export default function StorePage() {
  const m = useMerchant();
  const p = m.profile;

  return (
    <>
      <PageHeader title="المتجر والتوثيق" description="بيانات متجرك المسجلة لدى قطعة وحالة التحقق." />
      <div className="space-y-5">
        <StatusPanel />
        {!p && <LoadState loading error={undefined} />}
        {p && (
          <>
            <section className="card p-5">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-bold">{p.displayNameAr}</h2>
                <StatusBadge status={p.status} labels={MERCHANT_STATUS_AR} />
                <Badge>دورك: {ROLE_AR[p.myRole]}</Badge>
              </div>
              <dl className="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
                <Item k="الاسم القانوني" v={p.legalName} />
                <Item k="الاسم بالإنجليزية" v={p.displayNameEn} ltr />
                <Item k="السجل التجاري" v={p.crNumber} ltr />
                <Item k="الرقم الضريبي" v={p.vatNumber ?? "—"} ltr />
                <Item k="المدينة" v={cityAr(p.city)} />
                <Item k="جوال التواصل" v={p.contactPhone} ltr />
                <Item k="بريد التواصل" v={p.contactEmail} ltr />
                <Item k="عمولة قطعة" v={`${(p.commissionBps / 100).toFixed(1)}%`} />
                <Item k="مهلة القبول / التجهيز" v={`${Math.round(p.slaAcceptMinutes / 60)} س / ${Math.round(p.slaReadyMinutes / 60)} س`} />
                {p.approvedAt && <Item k="تاريخ الاعتماد" v={formatDate(p.approvedAt)} />}
              </dl>
            </section>

            <section className="card p-5" id="verification">
              <h2 className="mb-3 text-lg font-bold">مستندات التحقق</h2>
              {p.verifications.length === 0 && <p className="text-sm text-slate">لم تُرسل مستندات بعد.</p>}
              <ul className="space-y-3">
                {p.verifications.map((v) => (
                  <li key={v.id} className="rounded-lg border border-line p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={v.status === "PENDING" ? "PENDING" : v.status} labels={VERIFICATION_STATUS_AR} />
                      <span className="text-slate">أُرسلت {formatDateTime(v.createdAt)}</span>
                      {v.reviewedAt && <span className="text-slate">· روجعت {formatDateTime(v.reviewedAt)}</span>}
                    </div>
                    <ul className="mt-2 space-y-1">
                      {v.documents.map((d, i) => (
                        <li key={i} className="flex flex-wrap items-center gap-2">
                          <span>{label(DOCUMENT_TYPE_AR, d.type)}:</span>
                          <span className="ltr font-medium">{d.reference}</span>
                          {d.fileKey && <FileLink fileKey={d.fileKey} />}
                        </li>
                      ))}
                    </ul>
                    {v.notes && <p className="mt-2 text-slate">ملاحظاتك: {v.notes}</p>}
                    {v.reviewNote && <p className="mt-1">ملاحظة المراجع: {v.reviewNote}</p>}
                  </li>
                ))}
              </ul>
              {m.can("verification") ? (
                p.status === "SUSPENDED" ? (
                  <p className="mt-4 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">لا يمكن إرسال مستندات والمتجر موقوف. تواصل مع فريق قطعة.</p>
                ) : (
                  <VerificationForm onSubmitted={m.reloadProfile} />
                )
              ) : (
                <p className="mt-4 text-sm text-slate">إرسال مستندات التحقق متاح لمالك المتجر.</p>
              )}
            </section>
          </>
        )}
      </div>
    </>
  );
}

function Item({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return (
    <div className="border-b border-line py-1.5">
      <dt className="text-xs text-slate">{k}</dt>
      <dd className={`font-medium ${ltr ? "ltr text-start" : ""}`}>{v}</dd>
    </div>
  );
}

function FileLink({ fileKey }: { fileKey: string }) {
  const m = useMerchant();
  const [url, setUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (url)
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold text-brand underline">
        فتح الملف
      </a>
    );
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={async () => {
          try {
            const r = await api<{ url: string }>(`${m.base}/uploads`, { query: { key: fileKey } });
            setUrl(r.url);
          } catch (e) {
            setErr(errorText(e));
          }
        }}
      >
        عرض المرفق
      </button>
      {err && <span className="text-xs text-danger">{err}</span>}
    </>
  );
}
