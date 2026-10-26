"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";

import { ErrorNote, Field } from "@/components/ui/bits";
import { ApiError, authPost } from "@/lib/api";
import { normalizeSaudiMobile, toWesternDigits } from "@/lib/format";
import { CITIES, cityAr } from "@/lib/labels";
import type { Me } from "@/lib/types";

type Business = {
  legalName: string;
  displayNameAr: string;
  displayNameEn: string;
  crNumber: string;
  vatNumber: string;
  city: string;
  contactPhone: string;
  contactEmail: string;
  specialtyAr: string;
};
type Owner = { name: string; email: string; password: string; confirm: string };
type LocationForm = { name: string; city: string; district: string; street: string; contactPhone: string };
type Errors = Record<string, string>;

const STEPS = ["بيانات المنشأة", "حساب المالك", "موقع الاستلام الأول", "المراجعة والإرسال"];

const digitsOnly = (v: string) => toWesternDigits(v).replace(/\D/g, "");

function validateBusiness(b: Business): Errors {
  const e: Errors = {};
  if (b.legalName.trim().length < 2) e["business.legalName"] = "أدخل الاسم القانوني كما في السجل التجاري";
  if (b.displayNameAr.trim().length < 2) e["business.displayNameAr"] = "أدخل اسم المتجر بالعربية";
  if (b.displayNameEn.trim().length < 2) e["business.displayNameEn"] = "أدخل اسم المتجر بالإنجليزية";
  if (!/^\d{10}$/.test(digitsOnly(b.crNumber))) e["business.crNumber"] = "رقم السجل التجاري 10 أرقام";
  if (b.vatNumber.trim() && !/^3\d{13}3$/.test(digitsOnly(b.vatNumber))) e["business.vatNumber"] = "الرقم الضريبي 15 رقماً يبدأ وينتهي بالرقم 3";
  if (!b.city) e["business.city"] = "اختر المدينة";
  if (!normalizeSaudiMobile(b.contactPhone)) e["business.contactPhone"] = "رقم جوال سعودي مثل 05XXXXXXXX";
  if (!/^\S+@\S+\.\S+$/.test(b.contactEmail.trim())) e["business.contactEmail"] = "بريد إلكتروني غير صحيح";
  return e;
}

function validateOwner(o: Owner, linked: boolean): Errors {
  const e: Errors = {};
  if (linked) return e;
  if (o.name.trim().length < 2) e["owner.name"] = "أدخل اسم المالك";
  if (!/^\S+@\S+\.\S+$/.test(o.email.trim())) e["owner.email"] = "بريد إلكتروني غير صحيح";
  if (o.password.length < 10) e["owner.password"] = "10 أحرف على الأقل";
  if (o.confirm !== o.password) e["owner.confirm"] = "كلمتا المرور غير متطابقتين";
  return e;
}

function validateLocation(l: LocationForm): Errors {
  const e: Errors = {};
  if (l.name.trim().length < 2) e["location.name"] = "أدخل اسم الفرع أو المستودع";
  if (!l.city) e["location.city"] = "اختر المدينة";
  if (l.district.trim().length < 2) e["location.district"] = "أدخل الحي";
  if (l.street.trim().length < 2) e["location.street"] = "أدخل الشارع";
  if (!normalizeSaudiMobile(l.contactPhone)) e["location.contactPhone"] = "رقم جوال سعودي مثل 05XXXXXXXX";
  return e;
}

const stepOfPath = (path: string) => (path.startsWith("business") ? 0 : path.startsWith("owner") ? 1 : path.startsWith("location") ? 2 : 3);

export function RegisterWizard() {
  const [step, setStep] = useState(0);
  const [business, setBusiness] = useState<Business>({ legalName: "", displayNameAr: "", displayNameEn: "", crNumber: "", vatNumber: "", city: "riyadh", contactPhone: "", contactEmail: "", specialtyAr: "" });
  const [owner, setOwner] = useState<Owner>({ name: "", email: "", password: "", confirm: "" });
  const [location, setLocation] = useState<LocationForm>({ name: "", city: "riyadh", district: "", street: "", contactPhone: "" });
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [signedIn, setSignedIn] = useState<Me | null>(null);

  // If already signed in, the new store is attached to the current account (no new password).
  useEffect(() => {
    let cancelled = false;
    fetch("/api/proxy/v1/me", { credentials: "same-origin", cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then((me) => {
        if (!cancelled && me) setSignedIn(me);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const linked = !!signedIn;

  function next(e: FormEvent) {
    e.preventDefault();
    const errs = step === 0 ? validateBusiness(business) : step === 1 ? validateOwner(owner, linked) : step === 2 ? validateLocation(location) : {};
    setErrors(errs);
    if (Object.keys(errs).length) {
      // Move focus to the first invalid field for keyboard and screen-reader users.
      requestAnimationFrame(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus());
      return;
    }
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    void submit();
  }

  async function submit() {
    setBusy(true);
    setServerError(null);
    const payload = {
      business: {
        legalName: business.legalName.trim(),
        displayNameAr: business.displayNameAr.trim(),
        displayNameEn: business.displayNameEn.trim(),
        crNumber: digitsOnly(business.crNumber),
        ...(business.vatNumber.trim() ? { vatNumber: digitsOnly(business.vatNumber) } : {}),
        city: business.city,
        contactPhone: normalizeSaudiMobile(business.contactPhone),
        contactEmail: business.contactEmail.trim().toLowerCase(),
        specialtyAr: business.specialtyAr.trim(),
      },
      owner: linked
        ? { name: signedIn?.name ?? business.displayNameAr.trim(), email: signedIn?.email ?? business.contactEmail.trim().toLowerCase() }
        : { name: owner.name.trim(), email: owner.email.trim().toLowerCase(), password: owner.password },
      location: {
        name: location.name.trim(),
        city: location.city,
        district: location.district.trim(),
        street: location.street.trim(),
        contactPhone: normalizeSaudiMobile(location.contactPhone),
      },
    };
    try {
      const res = await authPost<{ merchantId: string }>("/api/auth/register", payload);
      try {
        window.localStorage.setItem("qitah.merchantId", res.merchantId);
      } catch {
        /* ignore */
      }
      // Full page load so the portal starts from the new session cookies.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.assign("/");
    } catch (err) {
      setBusy(false);
      setServerError(err);
      if (err instanceof ApiError) {
        const fieldErrs: Errors = {};
        for (const issue of err.fieldIssues) fieldErrs[issue.path] = issue.message;
        if (err.code === "EMAIL_IN_USE") fieldErrs["owner.email"] = "يوجد حساب بهذا البريد. سجّل الدخول أولاً ثم قدّم الطلب.";
        if (err.code === "ALREADY_EXISTS") fieldErrs["business.crNumber"] = "قد يكون هذا السجل التجاري مسجلاً مسبقاً.";
        setErrors(fieldErrs);
        const firstStep = Math.min(...Object.keys(fieldErrs).map(stepOfPath), 3);
        if (firstStep < 3) setStep(firstStep);
      }
    }
  }

  const bf = (k: keyof Business) => ({ value: business[k], onChange: (e: { target: { value: string } }) => setBusiness({ ...business, [k]: e.target.value }) });
  const of = (k: keyof Owner) => ({ value: owner[k], onChange: (e: { target: { value: string } }) => setOwner({ ...owner, [k]: e.target.value }) });
  const lf = (k: keyof LocationForm) => ({ value: location[k], onChange: (e: { target: { value: string } }) => setLocation({ ...location, [k]: e.target.value }) });

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold text-brand">تسجيل متجر جديد</h1>
      <p className="mt-1 text-sm text-slate">يراجع فريق قطعة طلبك عادةً خلال يوم عمل. بعد الاعتماد يمكنك نشر عروضك واستقبال الطلبات.</p>

      <ol className="mt-6 grid grid-cols-4 gap-2" aria-label="خطوات التسجيل">
        {STEPS.map((s, i) => (
          <li key={s} aria-current={i === step ? "step" : undefined} className="text-xs">
            <div className={`h-1.5 rounded-full ${i <= step ? "bg-brand" : "bg-line"}`} />
            <p className={`mt-1.5 ${i === step ? "font-bold text-brand" : "text-slate"}`}>
              {i + 1}. {s}
            </p>
          </li>
        ))}
      </ol>

      <form onSubmit={next} noValidate className="card mt-5 space-y-4 p-5 sm:p-6" data-testid={`register-step-${step}`}>
        <h2 className="text-lg font-bold">{STEPS[step]}</h2>

        {step === 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="الاسم القانوني للمنشأة" required error={errors["business.legalName"]} className="sm:col-span-2">
              {(p) => <input {...p} name="legalName" className="input" {...bf("legalName")} />}
            </Field>
            <Field label="اسم المتجر (عربي)" required error={errors["business.displayNameAr"]}>
              {(p) => <input {...p} name="displayNameAr" className="input" {...bf("displayNameAr")} />}
            </Field>
            <Field label="اسم المتجر (إنجليزي)" required error={errors["business.displayNameEn"]}>
              {(p) => <input {...p} name="displayNameEn" className="input ltr text-start" {...bf("displayNameEn")} />}
            </Field>
            <Field label="رقم السجل التجاري" required hint="10 أرقام" error={errors["business.crNumber"]}>
              {(p) => <input {...p} name="crNumber" className="input ltr text-start" inputMode="numeric" maxLength={10} {...bf("crNumber")} />}
            </Field>
            <Field label="الرقم الضريبي (اختياري)" hint="15 رقماً يبدأ وينتهي بـ 3" error={errors["business.vatNumber"]}>
              {(p) => <input {...p} name="vatNumber" className="input ltr text-start" inputMode="numeric" maxLength={15} {...bf("vatNumber")} />}
            </Field>
            <Field label="المدينة" required error={errors["business.city"]}>
              {(p) => (
                <select {...p} name="city" className="select" {...bf("city")}>
                  {CITIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.ar}
                    </option>
                  ))}
                </select>
              )}
            </Field>
            <Field label="تخصص المتجر (اختياري)" hint="مثال: قطع أصلية لتويوتا" error={errors["business.specialtyAr"]}>
              {(p) => <input {...p} name="specialtyAr" className="input" {...bf("specialtyAr")} />}
            </Field>
            <Field label="جوال التواصل" required hint="05XXXXXXXX" error={errors["business.contactPhone"]}>
              {(p) => <input {...p} name="contactPhone" className="input ltr text-start" inputMode="tel" autoComplete="tel" {...bf("contactPhone")} />}
            </Field>
            <Field label="بريد التواصل" required error={errors["business.contactEmail"]}>
              {(p) => <input {...p} name="contactEmail" type="email" className="input ltr text-start" autoComplete="email" {...bf("contactEmail")} />}
            </Field>
          </div>
        )}

        {step === 1 &&
          (linked ? (
            <p className="rounded-lg bg-brand-50 px-3 py-3 text-sm text-brand">
              أنت مسجّل الدخول بالحساب <strong className="ltr">{signedIn?.email}</strong>. سيُربط المتجر الجديد بهذا الحساب وتكون مالكه، ولا حاجة لكلمة مرور جديدة.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم المالك" required error={errors["owner.name"]}>
                {(p) => <input {...p} name="ownerName" className="input" autoComplete="name" {...of("name")} />}
              </Field>
              <Field label="البريد الإلكتروني للدخول" required error={errors["owner.email"]}>
                {(p) => <input {...p} name="ownerEmail" type="email" className="input ltr text-start" autoComplete="email" {...of("email")} />}
              </Field>
              <Field label="كلمة المرور" required hint="10 أحرف على الأقل" error={errors["owner.password"]}>
                {(p) => <input {...p} name="ownerPassword" type="password" className="input ltr text-start" autoComplete="new-password" {...of("password")} />}
              </Field>
              <Field label="تأكيد كلمة المرور" required error={errors["owner.confirm"]}>
                {(p) => <input {...p} name="ownerConfirm" type="password" className="input ltr text-start" autoComplete="new-password" {...of("confirm")} />}
              </Field>
            </div>
          ))}

        {step === 2 && (
          <>
            <p className="text-sm text-slate">المكان الذي يستلم منه مندوب الشحن الطلبات. يمكنك إضافة فروع أخرى لاحقاً.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="اسم الفرع أو المستودع" required error={errors["location.name"]}>
                {(p) => <input {...p} name="locationName" className="input" {...lf("name")} />}
              </Field>
              <Field label="المدينة" required error={errors["location.city"]}>
                {(p) => (
                  <select {...p} name="locationCity" className="select" {...lf("city")}>
                    {CITIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.ar}
                      </option>
                    ))}
                  </select>
                )}
              </Field>
              <Field label="الحي" required error={errors["location.district"]}>
                {(p) => <input {...p} name="locationDistrict" className="input" {...lf("district")} />}
              </Field>
              <Field label="الشارع" required error={errors["location.street"]}>
                {(p) => <input {...p} name="locationStreet" className="input" {...lf("street")} />}
              </Field>
              <Field label="جوال الفرع" required hint="05XXXXXXXX" error={errors["location.contactPhone"]}>
                {(p) => <input {...p} name="locationPhone" className="input ltr text-start" inputMode="tel" {...lf("contactPhone")} />}
              </Field>
            </div>
          </>
        )}

        {step === 3 && (
          <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
            <Review k="المنشأة" v={business.legalName} />
            <Review k="اسم المتجر" v={`${business.displayNameAr} / ${business.displayNameEn}`} />
            <Review k="السجل التجاري" v={digitsOnly(business.crNumber)} ltr />
            <Review k="الرقم الضريبي" v={digitsOnly(business.vatNumber) || "—"} ltr />
            <Review k="المدينة" v={cityAr(business.city)} />
            <Review k="التواصل" v={`${normalizeSaudiMobile(business.contactPhone) ?? ""} · ${business.contactEmail}`} ltr />
            <Review k="المالك" v={linked ? `${signedIn?.name ?? ""} (${signedIn?.email ?? ""})` : `${owner.name} (${owner.email})`} />
            <Review k="موقع الاستلام" v={`${location.name} — ${location.district}، ${location.street}، ${cityAr(location.city)}`} />
          </dl>
        )}

        <ErrorNote error={serverError} />

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-4">
          {step > 0 ? (
            <button type="button" className="btn btn-secondary" onClick={() => setStep(step - 1)} disabled={busy}>
              السابق
            </button>
          ) : (
            <Link href="/login" className="btn btn-ghost">
              لدي حساب — تسجيل الدخول
            </Link>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {step < 3 ? "التالي" : busy ? "جارٍ الإرسال…" : "إرسال الطلب"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Review({ k, v, ltr }: { k: string; v: string; ltr?: boolean }) {
  return (
    <div className="border-b border-line py-1.5">
      <dt className="text-xs text-slate">{k}</dt>
      <dd className={`font-medium ${ltr ? "ltr text-start" : ""}`}>{v}</dd>
    </div>
  );
}
