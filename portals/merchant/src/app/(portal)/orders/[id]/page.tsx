"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { OrderActions } from "@/components/orders/OrderActions";
import { ShipmentCard } from "@/components/orders/ShipmentCard";
import { useMerchant } from "@/components/portal/MerchantContext";
import { Badge, LoadState, StatusBadge } from "@/components/ui/bits";
import { formatDateTime, formatDue, formatSar, range } from "@/lib/format";
import { cityAr, CONDITION_AR, FIT_STATUS_AR, label, ORDER_STATUS_AR, REJECT_REASONS, RETURN_STATUS_AR } from "@/lib/labels";
import type { MerchantOrder } from "@/lib/types";
import { useApi, useNow } from "@/lib/useApi";

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const m = useMerchant();
  const res = useApi<MerchantOrder>(`${m.base}/orders/${id}`, { refreshOn: ["merchant_order", "shipment", "return", "order.paid"] });
  const now = useNow(15_000);
  const o = res.data;

  return (
    <>
      <nav className="mb-3 text-sm">
        <Link href="/orders" className="text-brand underline">
          ← الطلبات
        </Link>
      </nav>
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {o && <OrderView o={o} now={now} reload={res.reload} />}
    </>
  );
}

function OrderView({ o, now, reload }: { o: MerchantOrder; now: number; reload: () => void }) {
  const a = o.order.addressSnapshot;
  const fullAddress = !!(a.street || a.contactName || a.phone);
  const due = o.status === "NEW" ? o.acceptBy : o.status === "ACCEPTED" || o.status === "PACKING" ? o.readyBy : null;
  const sla = due ? formatDue(due, now) : null;
  const net = o.itemsHalalas - o.commissionHalalas;
  const outbound = o.shipments.filter((s) => s.direction === "OUTBOUND");
  const returns = o.shipments.filter((s) => s.direction === "RETURN");

  return (
    <div className="space-y-5" data-testid="order-detail" data-status={o.status}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold text-brand">
            <span>طلب</span> <span className="ltr">{o.number}</span>
            <StatusBadge status={o.status} labels={ORDER_STATUS_AR} />
          </h1>
          <p className="mt-1 text-sm text-slate">
            تم الدفع {formatDateTime(o.order.paidAt ?? o.createdAt)} · طلب العميل <span className="ltr">{o.order.number}</span>
          </p>
        </div>
        <OrderActions order={o} onDone={reload} />
      </div>

      {(sla || o.slaBreached) && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${sla?.overdue || o.slaBreached ? "border-danger/30 bg-danger-soft text-danger" : sla?.soon ? "border-warning/30 bg-warning-soft text-warning-text" : "border-line bg-white"}`}
          data-testid="sla"
        >
          {sla ? (
            <>
              <strong>{o.status === "NEW" ? "آخر موعد للقبول" : "آخر موعد لتجهيز الطلب"}:</strong> {formatDateTime(due)} — {sla.text}
            </>
          ) : null}
          {o.slaBreached && <p className="font-semibold">تم تجاوز مهلة التنفيذ لهذا الطلب.</p>}
        </div>
      )}

      <VehicleCard o={o} />

      {o.rejectedReason && (
        <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
          <strong>سبب {o.status === "CANCELLED" ? "الإلغاء" : "الرفض"}:</strong> {REJECT_REASONS.find((r) => r.id === o.rejectedReason)?.ar ?? o.rejectedReason}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-3">
        <section className="card overflow-x-auto lg:col-span-2">
          <h2 className="border-b border-line px-4 py-3 font-bold">القطع</h2>
          <table className="table">
            <thead>
              <tr>
                <th>القطعة</th>
                <th>التوافق</th>
                <th>رقم القطعة</th>
                <th>الحالة</th>
                <th>الكمية</th>
                <th>سعر الوحدة</th>
                <th>الإجمالي</th>
              </tr>
            </thead>
            <tbody>
              {o.items.map((i) => (
                <tr key={i.id} className={i.status === "CANCELLED" ? "opacity-60" : ""}>
                  <td>
                    <p className="font-medium">{i.productNameAr}</p>
                    {i.status === "CANCELLED" && <Badge>ملغى</Badge>}
                  </td>
                  <td className="text-sm" data-testid="item-fit" data-fit={i.fit?.status ?? "none"}>
                    {i.fit ? (
                      <div className="flex flex-col items-start gap-1">
                        <Badge tone={i.fit.guaranteed ? "success" : i.fitNeedsConfirmation ? "warning" : "neutral"}>{label(FIT_STATUS_AR, i.fit.status)}</Badge>
                        {i.fit.guaranteed && <span className="text-xs text-slate">مشمولة بضمان قطعة</span>}
                        {i.fitNeedsConfirmation && <span className="text-xs text-warning-text">تحقق من التوافق قبل التجهيز</span>}
                      </div>
                    ) : (
                      <span className="text-slate">—</span>
                    )}
                  </td>
                  <td className="ltr whitespace-nowrap text-start text-sm">{i.partNumber}</td>
                  <td className="text-sm">{label(CONDITION_AR, i.condition)}</td>
                  <td className="text-lg font-bold" data-testid="item-qty">
                    {i.quantity}
                  </td>
                  <td className="whitespace-nowrap">{formatSar(i.unitPriceHalalas)}</td>
                  <td className="whitespace-nowrap">{formatSar(i.lineTotalHalalas)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="grid gap-1 border-t border-line px-4 py-3 text-sm sm:max-w-sm sm:ms-auto">
            <Row k="قيمة القطع" v={formatSar(o.itemsHalalas)} />
            <Row k={`عمولة قطعة (${(o.commissionBps / 100).toFixed(1)}%)`} v={`- ${formatSar(o.commissionHalalas)}`} />
            <Row k="صافي مستحقك" v={formatSar(net)} strong />
            <Row k="الشحن (تدفعه قطعة للناقل)" v={formatSar(o.shippingHalalas)} muted />
          </dl>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 font-bold">التوصيل</h2>
          <dl className="space-y-2 text-sm">
            <Row k="المدينة" v={cityAr(a.city)} />
            <Row k="الحي" v={a.district ?? "—"} />
            <Row k="نوع العنوان" v={a.kind === "workshop" || a.kind === "WORKSHOP" ? "ورشة" : "منزل"} />
            {fullAddress ? (
              <>
                {a.workshopName && <Row k="الورشة" v={a.workshopName} />}
                {a.contactName && <Row k="المستلم" v={a.contactName} />}
                {a.phone && <Row k="الجوال" v={<span className="ltr">{a.phone}</span>} />}
                {a.street && <Row k="الشارع" v={a.street} />}
                {a.details && <Row k="تفاصيل" v={a.details} />}
              </>
            ) : (
              <p className="rounded bg-mist px-2 py-1.5 text-xs text-slate">يظهر العنوان الكامل وبيانات التواصل بعد قبول الطلب وأثناء تجهيزه فقط.</p>
            )}
          </dl>
          {o.groups.length > 0 && (
            <div className="mt-4 border-t border-line pt-3 text-sm">
              <p className="mb-1 font-semibold">يُشحن من</p>
              {o.groups.map((g) => (
                <p key={g.id}>
                  {g.originLocation.name} — {cityAr(g.originLocation.city)}
                  <span className="text-slate">
                    {" "}
                    · توصيل خلال {range(g.etaDaysMin, g.etaDaysMax)} يوم
                  </span>
                </p>
              ))}
            </div>
          )}
        </section>
      </div>

      <section aria-labelledby="ship-h">
        <h2 id="ship-h" className="mb-2 font-bold">
          الشحنات
        </h2>
        {outbound.length === 0 ? (
          <p className="card px-4 py-4 text-sm text-slate">تُنشأ الشحنة عندما تحدد الطلب «جاهز للاستلام». بعدها يصدر فريق قطعة البوليصة ويجدول استلام المندوب.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {outbound.map((s) => (
              <ShipmentCard key={s.id} s={s} />
            ))}
          </div>
        )}
      </section>

      {(o.returnCases.length > 0 || returns.length > 0) && (
        <section>
          <h2 className="mb-2 font-bold">المرتجعات</h2>
          <div className="card divide-y divide-line">
            {o.returnCases.map((r) => (
              <Link key={r.id} href="/returns" className="flex items-center justify-between px-4 py-3 hover:bg-mist">
                <span className="ltr">{r.number}</span>
                <StatusBadge status={r.status} labels={RETURN_STATUS_AR} />
              </Link>
            ))}
          </div>
          {returns.length > 0 && (
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              {returns.map((s) => (
                <ShipmentCard key={s.id} s={s} />
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/** Customer vehicle + VIN so the merchant can double-check fit; unverified fits are flagged (no blocking workflow). */
function VehicleCard({ o }: { o: MerchantOrder }) {
  const v = o.vehicle;
  if (!v && !o.fitNeedsConfirmation) return null;
  return (
    <section
      className={`rounded-lg border px-4 py-3 text-sm ${o.fitNeedsConfirmation ? "border-warning/30 bg-warning-soft" : "border-line bg-white"}`}
      data-testid="order-vehicle"
      data-needs-confirmation={o.fitNeedsConfirmation ? "true" : "false"}
    >
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
        <p>
          <strong>سيارة العميل:</strong> {v ? `${v.labelAr} · ${v.trim} · ${v.engine}` : "لم يحدد العميل سيارة"}
        </p>
        {v?.vin && (
          <p>
            <strong>رقم الهيكل (VIN):</strong> <span className="ltr font-mono">{v.vin}</span>
          </p>
        )}
      </div>
      {o.fitNeedsConfirmation && (
        <p className="mt-1 font-semibold text-warning-text">
          بعض القطع توافقها مُبلَّغ من البائع أو غير معروف لهذه السيارة. راجع رقم القطعة مع السيارة{v?.vin ? " ورقم الهيكل" : ""} قبل التجهيز، وتواصل مع العميل عبر قطعة عند الشك.
        </p>
      )}
    </section>
  );
}

function Row({ k, v, strong, muted }: { k: string; v: React.ReactNode; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${muted ? "text-slate" : ""}`}>
      <dt className={muted ? "" : "text-slate"}>{k}</dt>
      <dd className={strong ? "font-bold" : "font-medium"}>{v}</dd>
    </div>
  );
}
