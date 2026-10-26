"use client";

import { useMerchant } from "@/components/portal/MerchantContext";
import { EmptyState, Forbidden, LoadState, PageHeader } from "@/components/ui/bits";
import { formatDateTime } from "@/lib/format";
import { ACTION_AR, ACTOR_AR, label } from "@/lib/labels";
import type { AuditEvent } from "@/lib/types";
import { useApi } from "@/lib/useApi";

function summarize(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const text = JSON.stringify(data);
  return text.length > 140 ? `${text.slice(0, 140)}…` : text;
}

export default function ActivityPage() {
  const m = useMerchant();
  const res = useApi<{ events: AuditEvent[] }>(m.can("activity") ? `${m.base}/activity` : null, { refreshOn: ["*"] });
  if (!m.can("activity")) return <Forbidden />;

  return (
    <>
      <PageHeader title="سجل النشاط" description="آخر 100 إجراء على متجرك، من فريقك ومن فريق قطعة." />
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {res.data && res.data.events.length === 0 && <EmptyState title="لا يوجد نشاط بعد" />}
      {res.data && res.data.events.length > 0 && (
        <div className="card overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th>الإجراء</th>
                <th>بواسطة</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {res.data.events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap text-sm">{formatDateTime(e.createdAt)}</td>
                  <td>
                    <p className="font-medium">{label(ACTION_AR, e.action)}</p>
                    <p className="ltr text-start text-xs text-muted">{e.action}</p>
                  </td>
                  <td className="text-sm">{label(ACTOR_AR, e.actorType)}</td>
                  <td className="ltr max-w-[28rem] truncate text-start font-mono text-xs text-slate" title={summarize(e.data)}>
                    {summarize(e.data)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
