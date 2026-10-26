"use client";

import { useState, type FormEvent } from "react";

import { ErrorNote } from "@/components/ui/bits";
import { useToast } from "@/components/ui/Toast";
import { api, ApiError } from "@/lib/api";
import { DOCUMENT_TYPE_AR } from "@/lib/labels";

import { useMerchant } from "./MerchantContext";

type Row = { key: number; type: string; reference: string; file: File | null };
const MAX_BYTES = 10 * 1024 * 1024;
const TYPES = ["application/pdf", "image/jpeg", "image/png"];

/**
 * Verification documents (OWNER). Files go straight from the browser to storage: the API returns a
 * short-lived signed PUT URL (POST /uploads), and only the resulting key is sent with the documents.
 */
export function VerificationForm({ onSubmitted }: { onSubmitted: () => void }) {
  const m = useMerchant();
  const toast = useToast();
  const [rows, setRows] = useState<Row[]>([{ key: 1, type: "CR", reference: "", file: null }]);
  const [seq, setSeq] = useState(2);
  const [notes, setNotes] = useState("");
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const update = (key: number, patch: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  async function upload(file: File): Promise<string> {
    const target = await api<{ key: string; uploadUrl: string; method: "PUT"; headers: Record<string, string> }>(`${m.base}/uploads`, {
      method: "POST",
      body: { purpose: "verification", contentType: file.type, sizeBytes: file.size, fileName: file.name },
    });
    let res: Response;
    try {
      res = await fetch(target.uploadUrl, { method: target.method, headers: target.headers, body: file });
    } catch {
      throw new ApiError(0, "UPLOAD_FAILED", "Upload failed (network/CORS)");
    }
    if (!res.ok) throw new ApiError(res.status, "UPLOAD_FAILED", `Upload failed (${res.status})`);
    return target.key;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const errs: Record<number, string> = {};
    for (const r of rows) {
      if (r.reference.trim().length < 2) errs[r.key] = "أدخل رقم المستند أو مرجعه";
      else if (r.file && !TYPES.includes(r.file.type)) errs[r.key] = "الملف يجب أن يكون PDF أو JPEG أو PNG";
      else if (r.file && r.file.size > MAX_BYTES) errs[r.key] = "الحد الأقصى 10 ميجابايت";
    }
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setError(null);
    try {
      const documents = [];
      for (const r of rows) {
        let fileKey: string | undefined;
        if (r.file) {
          setBusy(`جارٍ رفع ${r.file.name}…`);
          fileKey = await upload(r.file);
        }
        documents.push({ type: r.type, reference: r.reference.trim(), ...(fileKey ? { fileKey } : {}) });
      }
      setBusy("جارٍ الإرسال…");
      await api(`${m.base}/verification`, { method: "POST", body: { documents, ...(notes.trim() ? { notes: notes.trim() } : {}) } });
      toast({ tone: "success", title: "تم إرسال المستندات للمراجعة" });
      setRows([{ key: seq, type: "CR", reference: "", file: null }]);
      setSeq(seq + 1);
      setNotes("");
      onSubmitted();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(null);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="mt-5 space-y-3 border-t border-line pt-4" data-testid="verification-form">
      <h3 className="font-semibold">إرسال مستندات جديدة</h3>
      {rows.map((r, i) => (
        <fieldset key={r.key} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[12rem_1fr_1fr_auto] sm:items-end">
          <legend className="sr-only">مستند {i + 1}</legend>
          <label className="text-sm">
            <span className="label">نوع المستند</span>
            <select className="select" value={r.type} onChange={(e) => update(r.key, { type: e.target.value })}>
              {Object.entries(DOCUMENT_TYPE_AR).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="label">الرقم / المرجع</span>
            <input className="input ltr text-start" value={r.reference} maxLength={120} aria-invalid={errors[r.key] ? true : undefined} onChange={(e) => update(r.key, { reference: e.target.value })} />
          </label>
          <label className="text-sm">
            <span className="label">الملف (اختياري — PDF/JPEG/PNG حتى 10MB)</span>
            <input type="file" accept="application/pdf,image/jpeg,image/png" className="block w-full text-sm" onChange={(e) => update(r.key, { file: e.target.files?.[0] ?? null })} />
          </label>
          {rows.length > 1 ? (
            <button type="button" className="btn btn-ghost btn-sm text-danger" onClick={() => setRows(rows.filter((x) => x.key !== r.key))}>
              حذف
            </button>
          ) : (
            <span />
          )}
          {errors[r.key] && <p className="field-error sm:col-span-4">{errors[r.key]}</p>}
        </fieldset>
      ))}
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={rows.length >= 10}
        onClick={() => {
          setRows([...rows, { key: seq, type: "VAT", reference: "", file: null }]);
          setSeq(seq + 1);
        }}
      >
        + مستند آخر
      </button>
      <label className="block text-sm">
        <span className="label">ملاحظات للمراجع (اختياري)</span>
        <textarea className="textarea" maxLength={1000} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <ErrorNote error={error} />
      <button type="submit" className="btn btn-primary" disabled={!!busy}>
        {busy ?? "إرسال للمراجعة"}
      </button>
    </form>
  );
}
