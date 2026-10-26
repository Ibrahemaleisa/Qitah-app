"use client";

import { useState, type FormEvent } from "react";

import { useMerchant } from "@/components/portal/MerchantContext";
import { Dialog } from "@/components/ui/Dialog";
import { Badge, ErrorNote, Field, Forbidden, LoadState, PageHeader } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError, errorText } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { ROLE_AR } from "@/lib/labels";
import type { MerchantRole, StaffMember } from "@/lib/types";
import { useApi } from "@/lib/useApi";

const ROLE_HELP: Record<MerchantRole, string> = {
  OWNER: "كل الصلاحيات، بما فيها الفريق والتوثيق",
  MANAGER: "الطلبات والكتالوج والفروع والمرتجعات والمستحقات",
  STAFF: "الطلبات وتحديث المخزون فقط",
};

export default function StaffPage() {
  const m = useMerchant();
  const toast = useToast();
  const res = useApi<{ staff: StaffMember[] }>(m.can("staff") ? `${m.base}/staff` : null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [guard, setGuard] = useState<string | null>(null);

  if (!m.can("staff")) return <Forbidden message="إدارة فريق العمل متاحة لمالك المتجر فقط." />;

  async function update(member: StaffMember, body: { role?: MerchantRole; status?: "ACTIVE" | "DISABLED" }) {
    setBusy(member.id);
    setGuard(null);
    try {
      await api(`${m.base}/staff/${member.id}`, { method: "PATCH", body });
      toast({ tone: "success", title: "تم تحديث عضو الفريق", body: member.user.name ?? member.user.email ?? "" });
      res.reload();
      // Changing your own role changes what you can do: refresh /me.
      if (member.user.id === m.me.id) m.reloadMe();
    } catch (e) {
      if (e instanceof ApiError && e.code === "LAST_OWNER") setGuard(member.id);
      else toast({ tone: "error", title: "تعذر التحديث", body: errorText(e) });
      res.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        title="فريق العمل"
        description="أضف المديرين والموظفين وحدد صلاحياتهم. يدخل كل عضو بحسابه الخاص."
        actions={
          <button type="button" className="btn btn-primary" onClick={() => setAdding(true)} data-testid="add-staff">
            إضافة عضو
          </button>
        }
      />
      <ul className="mb-4 grid gap-2 text-sm sm:grid-cols-3">
        {(Object.keys(ROLE_HELP) as MerchantRole[]).map((r) => (
          <li key={r} className="rounded-lg bg-white px-3 py-2 ring-1 ring-line">
            <strong>{ROLE_AR[r]}:</strong> <span className="text-slate">{ROLE_HELP[r]}</span>
          </li>
        ))}
      </ul>
      <LoadState loading={res.loading} error={res.error} onRetry={res.reload} />
      {res.data && (
        <div className="card overflow-x-auto">
          <table className="table" data-testid="staff-table">
            <thead>
              <tr>
                <th>الاسم</th>
                <th>البريد</th>
                <th>الدور</th>
                <th>الحالة</th>
                <th>منذ</th>
                <th>
                  <span className="sr-only">إجراءات</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {res.data.staff.map((s) => (
                <tr key={s.id}>
                  <td className="font-medium">
                    {s.user.name ?? "—"} {s.user.id === m.me.id && <Badge tone="brand">أنت</Badge>}
                  </td>
                  <td className="ltr text-start text-sm">{s.user.email ?? s.user.phone}</td>
                  <td>
                    <label className="sr-only" htmlFor={`role-${s.id}`}>
                      الدور
                    </label>
                    <select id={`role-${s.id}`} className="select input-sm w-auto" value={s.role} disabled={busy === s.id} onChange={(e) => update(s, { role: e.target.value as MerchantRole })}>
                      <option value="OWNER">مالك</option>
                      <option value="MANAGER">مدير</option>
                      <option value="STAFF">موظف</option>
                    </select>
                    {guard === s.id && (
                      <p role="alert" className="mt-1 max-w-[16rem] text-xs text-danger">
                        لا يمكن تغيير دور آخر مالك نشط أو تعطيله. عيّن مالكاً آخر أولاً.
                      </p>
                    )}
                  </td>
                  <td>
                    <Badge tone={s.status === "ACTIVE" ? "success" : "neutral"}>{s.status === "ACTIVE" ? "نشط" : "معطّل"}</Badge>
                  </td>
                  <td className="text-sm text-slate">{formatDate(s.createdAt)}</td>
                  <td>
                    <button type="button" className={`btn btn-sm ${s.status === "ACTIVE" ? "btn-danger" : "btn-secondary"}`} disabled={busy === s.id} onClick={() => update(s, { status: s.status === "ACTIVE" ? "DISABLED" : "ACTIVE" })}>
                      {s.status === "ACTIVE" ? "تعطيل" : "تفعيل"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {adding && <AddStaffDialog onClose={() => setAdding(false)} onSaved={res.reload} />}
    </>
  );
}

function AddStaffDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const [f, setF] = useState({ name: "", email: "", role: "STAFF", password: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (f.name.trim().length < 2) errs.name = "أدخل الاسم";
    if (!/^\S+@\S+\.\S+$/.test(f.email.trim())) errs.email = "بريد إلكتروني غير صحيح";
    if (f.password.length < 10) errs.password = "10 أحرف على الأقل";
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setBusy(true);
    setServerError(null);
    try {
      await api(`${m.base}/staff`, { method: "POST", body: { name: f.name.trim(), email: f.email.trim().toLowerCase(), role: f.role, password: f.password } });
      toast({ tone: "success", title: "تمت إضافة العضو", body: "شارك معه البريد وكلمة المرور الأولية بطريقة آمنة." });
      onSaved();
      onClose();
    } catch (err) {
      setServerError(err);
      if (err instanceof ApiError && err.code === "ALREADY_EXISTS") setErrors({ email: "هذا الشخص عضو في المتجر بالفعل" });
      setBusy(false);
    }
  }

  return (
    <Dialog open onClose={onClose} title="إضافة عضو للفريق">
      <form onSubmit={submit} noValidate className="space-y-4" data-testid="staff-form">
        <Field label="الاسم" required error={errors.name}>
          {(p) => <input {...p} className="input" value={f.name} onChange={set("name")} />}
        </Field>
        <Field label="البريد الإلكتروني" required hint="إن كان لديه حساب قطعة بهذا البريد يُضاف بحسابه الحالي" error={errors.email}>
          {(p) => <input {...p} type="email" className="input ltr text-start" value={f.email} onChange={set("email")} />}
        </Field>
        <Field label="الدور" required>
          {(p) => (
            <select {...p} className="select" value={f.role} onChange={set("role")}>
              <option value="STAFF">موظف — {ROLE_HELP.STAFF}</option>
              <option value="MANAGER">مدير — {ROLE_HELP.MANAGER}</option>
            </select>
          )}
        </Field>
        <Field label="كلمة مرور أولية" required hint="10 أحرف على الأقل. اطلب منه تغييرها بعد أول دخول." error={errors.password}>
          {(p) => <input {...p} type="password" autoComplete="new-password" className="input ltr text-start" value={f.password} onChange={set("password")} />}
        </Field>
        <ErrorNote error={serverError} />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            إلغاء
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? "جارٍ الإضافة…" : "إضافة"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
