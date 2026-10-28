"use client";

import { useState, type FormEvent } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, EmptyState, ErrorNote, Field, Forbidden, LoadState, PageHeader } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, errorText } from "@/lib/api";
import { normalizeSaudiMobile } from "@/lib/format";
import { CITIES, cityAr } from "@/lib/labels";
import type { Location } from "@/lib/types";
import { useApi } from "@/lib/useApi";

export default function LocationsPage() {
  const m = useMerchant();
  const toast = useToast();
  const res = useApi<{ locations: Location[] }>(`${m.base}/locations`);
  const [editing, setEditing] = useState<Location | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  if (!m.can("locations.manage")) return <Forbidden />;

  async function toggle(l: Location) {
    setBusy(l.id);
    try {
      await api(`${m.base}/locations/${l.id}`, { method: "PATCH", body: { active: !l.active } });
      toast({ tone: "success", title: l.active ? "تم إيقاف الفرع" : "تم تفعيل الفرع", body: l.name });
      res.reload();
    } catch (e) {
      toast({ tone: "error", title: "تعذر التحديث", body: errorText(e) });
    } finally {
      setBusy(null);
    }
  }

  const list = res.data?.locations ?? [];
  return (
    <>
      <PageHeader
        title="الفروع ومواقع الاستلام"
        description="الأماكن التي يستلم منها مندوب الشحن طلباتك. العروض المرتبطة بفرع موقوف لا تظهر للعملاء."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setEditing("new")} data-testid="add-location">
            إضافة فرع
          </button>
        }
      />
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {res.data && list.length === 0 && <EmptyState title="لا توجد فروع" body="أضف فرعاً واحداً على الأقل لتتمكن من نشر العروض." />}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((l) => (
          <article key={l.id} className={`card p-4 ${l.active ? "" : "opacity-70"}`} data-testid="location-card">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-bold">{l.name}</h2>
              <Badge tone={l.active ? "success" : "neutral"}>{l.active ? "نشط" : "موقوف"}</Badge>
            </div>
            <p className="mt-1 text-sm">
              {l.district}، {l.street}
            </p>
            <p className="text-sm text-slate">{cityAr(l.city)}</p>
            <p className="ltr mt-1 text-start text-sm text-slate">{l.contactPhone}</p>
            <p className="mt-1 text-sm text-slate">آخر موعد لطلبات «يصلك اليوم»: <span className="ltr">{toHhmm(l.sameDayCutoffMinutes ?? 840)}</span></p>
            <div className="mt-3 flex gap-2">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(l)}>
                تعديل
              </button>
              <button type="button" className={`btn btn-sm ${l.active ? "btn-danger" : "btn-secondary"}`} disabled={busy === l.id} onClick={() => toggle(l)}>
                {l.active ? "إيقاف" : "تفعيل"}
              </button>
            </div>
          </article>
        ))}
      </div>
      {editing && <LocationDialog location={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={res.reload} />}
    </>
  );
}

function LocationDialog({ location, onClose, onSaved }: { location: Location | null; onClose: () => void; onSaved: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const [f, setF] = useState({
    name: location?.name ?? "",
    city: location?.city ?? "riyadh",
    district: location?.district ?? "",
    street: location?.street ?? "",
    contactPhone: location?.contactPhone ?? "",
    cutoff: toHhmm(location?.sameDayCutoffMinutes ?? 840),
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.name.trim().length < 2) errs.name = "أدخل اسم الفرع";
    if (f.district.trim().length < 2) errs.district = "أدخل الحي";
    if (f.street.trim().length < 2) errs.street = "أدخل الشارع";
    const phone = normalizeSaudiMobile(f.contactPhone);
    if (!phone) errs.contactPhone = "رقم جوال سعودي مثل 05XXXXXXXX";
    const cutoff = fromHhmm(f.cutoff);
    if (cutoff === null) errs.cutoff = "وقت بصيغة 14:00";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError(null);
    const body = { name: f.name.trim(), city: f.city, district: f.district.trim(), street: f.street.trim(), contactPhone: phone, sameDayCutoffMinutes: cutoff ?? 840 };
    try {
      if (location) await api(`${m.base}/locations/${location.id}`, { method: "PATCH", body });
      else await api(`${m.base}/locations`, { method: "POST", body });
      toast({ tone: "success", title: location ? "تم حفظ الفرع" : "تمت إضافة الفرع", body: body.name });
      onSaved();
      onClose();
    } catch (err) {
      setServerError(err);
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title={location ? `تعديل ${location.name}` : "إضافة فرع"}>
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="location-form">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="اسم الفرع" required error={errors.name}>
            {(p) => <input {...p} name="name" className="input" value={f.name} onChange={set("name")} />}
          </Field>
          <Field label="المدينة" required>
            {(p) => (
              <select {...p} name="city" className="select" value={f.city} onChange={set("city")}>
                {CITIES.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.ar}
                  </option>
                ))}
              </select>
            )}
          </Field>
          <Field label="الحي" required error={errors.district}>
            {(p) => <input {...p} name="district" className="input" value={f.district} onChange={set("district")} />}
          </Field>
          <Field label="الشارع" required error={errors.street}>
            {(p) => <input {...p} name="street" className="input" value={f.street} onChange={set("street")} />}
          </Field>
          <Field label="جوال الفرع" required hint="05XXXXXXXX" error={errors.contactPhone}>
            {(p) => <input {...p} name="contactPhone" className="input ltr text-start" inputMode="tel" value={f.contactPhone} onChange={set("contactPhone")} />}
          </Field>
          <Field label="آخر موعد لطلبات «يصلك اليوم» (بتوقيت الرياض)" hint="الطلبات قبل هذا الوقت من هذا الفرع تُعرض للعميل كـ«يصلك اليوم» إن كان تجهيزك في نفس اليوم" error={errors.cutoff}>
            {(p) => <input {...p} name="cutoff" type="time" className="input ltr text-start" value={f.cutoff} onChange={set("cutoff")} />}
          </Field>
        </div>
        <ErrorNote error={serverError} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy} data-testid="save-location">
            {busy ? "جارٍ الحفظ…" : "حفظ"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

const toHhmm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;

function fromHhmm(v: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(v.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  return h <= 23 && mm <= 59 ? h * 60 + mm : null;
}
