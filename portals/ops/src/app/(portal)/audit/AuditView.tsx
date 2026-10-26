'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { Async, Card, Chip, DateTime, Empty, JsonDetails, Mono, PageHead } from '@/components/ui';
import { qs } from '@/lib/api';
import { shortId } from '@/lib/format';
import { useApi } from '@/lib/hooks';
import { ACTOR_LABEL, auditLabel, ENTITY_LABEL } from '@/lib/labels';
import type { AuditEvent } from '@/lib/types';

const LIMIT = 50;
const ENTITY_TYPES = ['order', 'merchant_order', 'shipment', 'return_case', 'merchant', 'settlement', 'user', 'offer', 'location', 'product'];

function entityHref(a: AuditEvent): string | undefined {
  switch (a.entityType) {
    case 'order':
      return `/orders/${a.entityId}`;
    case 'shipment':
      return `/tower/shipments/${a.entityId}`;
    case 'merchant':
      return `/merchants/${a.entityId}`;
    case 'return_case':
      return `/returns?focus=${a.entityId}`;
    default:
      return undefined;
  }
}

export function AuditView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const entityType = params.get('entityType') ?? '';
  const entityId = params.get('entityId') ?? '';
  const merchantId = params.get('merchantId') ?? '';
  const [form, setForm] = useState({ entityType, entityId, merchantId });
  const [offset, setOffset] = useState(0);
  const state = useApi<{ events: AuditEvent[] }>(`v1/ops/audit${qs({ entityType, entityId, merchantId, limit: LIMIT, offset })}`);

  const apply = (e: React.FormEvent) => {
    e.preventDefault();
    setOffset(0);
    router.replace(`${pathname}${qs({ entityType: form.entityType, entityId: form.entityId.trim(), merchantId: form.merchantId.trim() })}`);
  };

  return (
    <>
      <PageHead title="سجل التدقيق" sub="كل إجراء على المنصة: من نفّذه، متى، وعلى أي كيان" />
      <form className="toolbar" onSubmit={apply}>
        <select aria-label="نوع الكيان" value={form.entityType} onChange={(e) => setForm({ ...form, entityType: e.target.value })}>
          <option value="">كل الأنواع</option>
          {ENTITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {ENTITY_LABEL[t] ?? t}
            </option>
          ))}
        </select>
        <input aria-label="معرّف الكيان" placeholder="معرّف الكيان" dir="ltr" value={form.entityId} onChange={(e) => setForm({ ...form, entityId: e.target.value })} />
        <input aria-label="معرّف التاجر" placeholder="معرّف التاجر" dir="ltr" value={form.merchantId} onChange={(e) => setForm({ ...form, merchantId: e.target.value })} />
        <button className="btn btn-primary" type="submit">
          تطبيق
        </button>
        {entityType || entityId || merchantId ? (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setForm({ entityType: '', entityId: '', merchantId: '' });
              setOffset(0);
              router.replace(pathname);
            }}
          >
            مسح
          </button>
        ) : null}
      </form>
      <Card flush>
        <Async state={state}>
          {(d) =>
            d.events.length ? (
              <>
                <div className="table-wrap">
                  <table className="t">
                    <thead>
                      <tr>
                        <th>الوقت</th>
                        <th>المنفّذ</th>
                        <th>الإجراء</th>
                        <th>الكيان</th>
                        <th>التاجر</th>
                        <th>البيانات</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.events.map((a) => {
                        const href = entityHref(a);
                        return (
                          <tr key={a.id}>
                            <td>
                              <DateTime iso={a.createdAt} />
                            </td>
                            <td>
                              <Chip tone={a.actorType === 'ops' ? 'info' : 'neutral'}>{ACTOR_LABEL[a.actorType] ?? a.actorType}</Chip>
                              {a.actorUserId ? (
                                <div className="cell-sub">
                                  <Mono>{shortId(a.actorUserId)}</Mono>
                                </div>
                              ) : null}
                            </td>
                            <td>
                              {auditLabel(a.action)}
                              <div className="cell-sub mono">{a.action}</div>
                            </td>
                            <td>
                              {ENTITY_LABEL[a.entityType] ?? a.entityType}{' '}
                              {href ? (
                                <Link href={href}>
                                  <Mono>{shortId(a.entityId)}</Mono>
                                </Link>
                              ) : (
                                <Mono>{shortId(a.entityId)}</Mono>
                              )}
                            </td>
                            <td>{a.merchantId ? <Link href={`/merchants/${a.merchantId}`}>{a.merchantId}</Link> : <span className="muted">—</span>}</td>
                            <td>
                              <JsonDetails value={a.data} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="pager">
                  <span className="muted num">
                    {offset + 1}–{offset + d.events.length}
                  </span>
                  <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}>
                    الأحدث
                  </button>
                  <button className="btn btn-sm" disabled={d.events.length < LIMIT} onClick={() => setOffset(offset + LIMIT)}>
                    الأقدم
                  </button>
                </div>
              </>
            ) : (
              <Empty>لا توجد أحداث مطابقة</Empty>
            )
          }
        </Async>
      </Card>
    </>
  );
}
