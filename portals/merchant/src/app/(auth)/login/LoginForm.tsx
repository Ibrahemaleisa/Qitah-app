"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";

import { ErrorNote, Field } from "@/components/ui/bits";
import { ApiError, authPost } from "@/lib/api";

/** Only same-site relative paths are accepted as a post-login destination. */
function safeNext(next: string | null): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/api/")) return "/";
  return next;
}

export function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await authPost("/api/auth/login", { email, password });
      // Full navigation so the portal starts with a clean state for this account.
      window.location.assign(safeNext(params.get("next")));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  const wrongCredentials = error instanceof ApiError && error.status === 401;

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4" noValidate>
      {params.get("expired") && !error && (
        <p role="status" className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-text">
          انتهت الجلسة. سجّل الدخول مرة أخرى.
        </p>
      )}
      <Field label="البريد الإلكتروني" required>
        {(p) => <input {...p} className="input ltr text-start" type="email" autoComplete="username" inputMode="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" />}
      </Field>
      <Field label="كلمة المرور" required>
        {(p) => <input {...p} className="input ltr text-start" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} name="password" />}
      </Field>
      {wrongCredentials ? (
        <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
          البريد الإلكتروني أو كلمة المرور غير صحيحة.
        </p>
      ) : (
        <ErrorNote error={error} />
      )}
      <button type="submit" className="btn btn-primary w-full" disabled={busy || !email || !password}>
        {busy ? "جارٍ الدخول…" : "دخول"}
      </button>
      <p className="text-center text-sm text-slate">
        متجر جديد على قطعة؟{" "}
        <Link href="/register" className="font-semibold text-brand underline">
          سجّل متجرك
        </Link>
      </p>
    </form>
  );
}
