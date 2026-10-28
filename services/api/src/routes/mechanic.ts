import type { MechanicReview } from '@prisma/client';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parse, rateLimit } from '../lib/http.js';
import { findByToken, submitMechanicReview, type MechanicForm, type ReviewDecision, type ReviewLine, type ReviewSnapshot } from '../services/mechanicReviews.js';

/**
 * Public mechanic review page — no account, Arabic RTL, no JavaScript.
 * Everything user-supplied is HTML-escaped; the page is noindex, never cached, sends no referrer
 * (the token is in the URL) and shows no customer name, phone or address.
 */

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const FIT: Record<string, { label: string; cls: string }> = {
  catalog: { label: 'متوافقة حسب الكتالوج', cls: 'ok' },
  seller: { label: 'توافق أبلغ عنه البائع (غير مؤكد)', cls: 'warn' },
  universal: { label: 'تناسب حسب المواصفات', cls: 'info' },
  unverified: { label: 'لا توجد بيانات توافق لهذه السيارة', cls: 'muted' },
  no_vehicle: { label: 'لم يحدد العميل السيارة', cls: 'muted' },
};
const CONDITION: Record<string, string> = { NEW: 'جديد', USED: 'مستعمل', REFURBISHED: 'مجدد' };
const ORIGIN: Record<string, string> = { oem: 'أصلي (وكالة)', aftermarket: 'بديل تجاري' };

function page(title: string, body: string) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${esc(title)}</title>
<style>
*{box-sizing:border-box}body{font-family:system-ui,-apple-system,"Segoe UI",Tahoma,sans-serif;background:#F5F7FA;color:#0B1B33;margin:0;padding:16px;line-height:1.6}
main{max-width:560px;margin:auto}.card{background:#fff;border-radius:16px;padding:16px;margin-bottom:12px;box-shadow:0 1px 3px #0001}
h1{font-size:20px;margin:0 0 4px}h2{font-size:16px;margin:0 0 8px}.muted{color:#5B6B82;font-size:14px}.ltr{direction:ltr;unicode-bidi:isolate;font-family:ui-monospace,Menlo,monospace}
.tag{display:inline-block;border-radius:999px;padding:2px 10px;font-size:13px;margin:2px 0}.ok{background:#E3F6EA;color:#0F6B35}.warn{background:#FFF4D6;color:#7A4B00}.info{background:#E6EEFB;color:#0047BA}.muted.tag{background:#EEF1F6}
.row{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.choice{display:flex;gap:16px;margin:10px 0}.choice label{display:flex;gap:6px;align-items:center;font-weight:600}
input[type=text],input[type=tel],textarea,select{width:100%;padding:10px;border:1px solid #D5DCE6;border-radius:10px;font-size:15px;font-family:inherit;margin-top:4px;background:#fff}
fieldset{border:1px dashed #D5DCE6;border-radius:12px;padding:8px 12px;margin:8px 0}legend{font-size:13px;color:#5B6B82;padding:0 4px}
button{width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;font-weight:700;background:#0047BA;color:#fff;cursor:pointer}
.err{background:#FDE8E8;color:#9B1C1C;border-radius:10px;padding:10px 12px;margin-bottom:12px}.brand{font-weight:800;color:#0047BA}
</style></head><body><main>${body}<p class="muted" style="text-align:center">قطعة — سوق قطع الغيار · لا نعرض أي بيانات شخصية للعميل في هذه الصفحة</p></main></body></html>`;
}

function send(reply: FastifyReply, status: number, html: string) {
  return reply
    .code(status)
    .header('content-type', 'text/html; charset=utf-8')
    .header('x-robots-tag', 'noindex, nofollow')
    .header('cache-control', 'no-store')
    .header('referrer-policy', 'no-referrer')
    .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'")
    .send(html);
}

function vehicleCard(s: ReviewSnapshot, note: string | null) {
  const v = s.vehicle;
  const vehicle = v
    ? `<h2>السيارة</h2><div><b>${esc(v.makeAr)} ${esc(v.modelAr)} ${esc(v.year)}</b></div>
<div class="muted">المحرك: <span class="ltr">${esc(v.engine)}</span></div>
${v.vin ? `<div class="muted">رقم الهيكل (VIN): <span class="ltr">${esc(v.vin)}</span></div>` : ''}`
    : '<h2>السيارة</h2><div class="muted">لم يحدد العميل السيارة — تأكد منها قبل الاعتماد.</div>';
  return `<div class="card">${vehicle}${note ? `<div style="margin-top:8px"><b>ملاحظة العميل:</b> ${esc(note)}</div>` : ''}</div>`;
}

function lineHeader(l: ReviewLine) {
  const fit = FIT[l.fit] ?? FIT.unverified;
  return `<h2>${esc(l.nameAr)} <span class="muted">× ${esc(l.quantity)}</span></h2>
<div class="row muted"><span>الماركة: <b>${esc(l.brand)}</b></span><span>·</span><span>رقم القطعة: <span class="ltr">${esc(l.partNumber)}</span></span></div>
${l.oemReferences.length ? `<div class="muted">أرقام مرجعية: ${l.oemReferences.map((r) => `<span class="ltr">${esc(r)}</span>`).join('، ')}</div>` : ''}
<div class="row"><span class="tag info">${esc(ORIGIN[l.origin] ?? l.origin)}</span><span class="tag muted">${esc(CONDITION[l.condition] ?? l.condition)}</span><span class="tag ${fit.cls}">${esc(fit.label)}</span></div>`;
}

function formPage(r: MechanicReview, error?: string, form: MechanicForm = {}) {
  const s = r.snapshot as unknown as ReviewSnapshot;
  const val = (k: string) => esc(form[k] ?? '');
  const lines = s.lines
    .map((l, i) => {
      const d = form[`decision_${i}`];
      const alts = l.alternatives.length
        ? `<label>أو اختر عرضاً آخر لنفس القطعة<select name="alt_offer_${i}"><option value="">—</option>${l.alternatives
            .map((a) => `<option value="${esc(a.offerId)}"${form[`alt_offer_${i}`] === a.offerId ? ' selected' : ''}>${esc(CONDITION[a.condition] ?? a.condition)} · ${esc(a.sellerAr)}${a.warrantyMonths ? ` · ضمان ${esc(a.warrantyMonths)} شهر` : ''}</option>`)
            .join('')}</select></label>`
        : '';
      return `<div class="card">${lineHeader(l)}
<div class="choice"><label><input type="radio" name="decision_${i}" value="approve"${d === 'approve' ? ' checked' : ''} required> مناسبة ✔</label><label><input type="radio" name="decision_${i}" value="alternative"${d === 'alternative' ? ' checked' : ''}> اقترح بديلاً</label></div>
<fieldset><legend>إذا اقترحت بديلاً</legend>
<label>وصف البديل<input type="text" name="alt_text_${i}" maxlength="200" value="${val(`alt_text_${i}`)}"></label>
<label>رقم القطعة البديلة<input type="text" name="alt_pn_${i}" maxlength="60" dir="ltr" value="${val(`alt_pn_${i}`)}"></label>
${alts}</fieldset></div>`;
    })
    .join('');
  return page(
    'مراجعة قطع — قطعة',
    `<div class="card"><div class="brand">قطعة</div><h1>طلب مراجعة قطع من عميلك</h1><div class="muted">راجع القطع واعتمد المناسب منها أو اقترح بديلاً. لا تحتاج إلى حساب.</div></div>
${error ? `<div class="err">${esc(error)}</div>` : ''}
${vehicleCard(s, r.note)}
<form method="post">${lines}
<div class="card"><h2>بيانات الورشة (اختياري)</h2>
<label>اسم الورشة<input type="text" name="workshop_name" maxlength="80" value="${val('workshop_name')}"></label>
<label>جوال الورشة<input type="tel" name="workshop_phone" maxlength="20" dir="ltr" placeholder="05XXXXXXXX" value="${val('workshop_phone')}"></label>
<label>ملاحظة للعميل<textarea name="mechanic_note" maxlength="500" rows="3">${val('mechanic_note')}</textarea></label>
<div class="muted">إذا كتبت بيانات الورشة يمكن للعميل اختيار توصيل القطع إليها مباشرة.</div></div>
<button type="submit">إرسال المراجعة</button></form>
<p class="muted" style="text-align:center">ينتهي هذا الرابط في ${esc(r.expiresAt.toISOString().slice(0, 16).replace('T', ' '))} UTC</p>`,
  );
}

function donePage(r: MechanicReview) {
  const s = r.snapshot as unknown as ReviewSnapshot;
  const decisions = (r.decisions ?? []) as unknown as ReviewDecision[];
  const lines = s.lines
    .map((l) => {
      const d = decisions.find((x) => x.offerId === l.offerId);
      const alt = d?.decision === 'ALTERNATIVE'
        ? `<div><b>البديل المقترح:</b> ${[d.text ? esc(d.text) : '', d.partNumber ? `<span class="ltr">${esc(d.partNumber)}</span>` : '', d.alternativeOfferId ? 'عرض آخر لنفس القطعة' : ''].filter(Boolean).join(' · ')}</div>`
        : '';
      return `<div class="card">${lineHeader(l)}<div style="margin-top:6px">${d?.decision === 'APPROVED' ? '<span class="tag ok">معتمدة</span>' : '<span class="tag warn">اقتُرح بديل</span>'}</div>${alt}</div>`;
    })
    .join('');
  return page(
    'تم إرسال المراجعة — قطعة',
    `<div class="card"><div class="brand">قطعة</div><h1>شكراً، وصلت مراجعتك للعميل ✔</h1><div class="muted">${r.status === 'APPROVED' ? 'اعتمدت جميع القطع.' : 'اقترحت تعديلات على بعض القطع.'}</div></div>${vehicleCard(s, r.note)}${lines}`,
  );
}

const gonePage = (title: string, text: string) => page(title, `<div class="card"><div class="brand">قطعة</div><h1>${esc(title)}</h1><div class="muted">${esc(text)}</div></div>`);

export async function mechanicPublicRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 32 * 1024 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  const tokenParam = z.object({ token: z.string().max(120) });

  async function load(token: string) {
    const r = await findByToken(token);
    if (!r) return { state: 'missing' as const };
    if (r.status !== 'PENDING') return { state: 'done' as const, r };
    if (r.expiresAt.getTime() <= Date.now()) return { state: 'expired' as const, r };
    return { state: 'open' as const, r };
  }

  app.get('/m/:token', rateLimit(ctx.config.RATE_LIMIT_SCALE, 60, '1 minute'), async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const x = await load(token);
    if (x.state === 'missing') return send(reply, 404, gonePage('الرابط غير صالح', 'تأكد من نسخ الرابط كاملاً من رسالة العميل.'));
    if (x.state === 'expired') return send(reply, 410, gonePage('انتهت صلاحية الرابط', 'اطلب من العميل إرسال رابط جديد من تطبيق قطعة.'));
    if (x.state === 'done') return send(reply, 200, donePage(x.r));
    return send(reply, 200, formPage(x.r));
  });

  app.post('/m/:token', rateLimit(ctx.config.RATE_LIMIT_SCALE, 10, '1 minute'), async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const x = await load(token);
    if (x.state === 'missing') return send(reply, 404, gonePage('الرابط غير صالح', 'تأكد من نسخ الرابط كاملاً من رسالة العميل.'));
    if (x.state === 'expired') return send(reply, 410, gonePage('انتهت صلاحية الرابط', 'اطلب من العميل إرسال رابط جديد من تطبيق قطعة.'));
    if (x.state === 'done') return send(reply, 409, donePage(x.r));
    const form = (req.body && typeof req.body === 'object' ? req.body : {}) as MechanicForm;
    try {
      await submitMechanicReview(x.r, form);
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 400) return send(reply, 400, formPage(x.r, e.message, form));
      if (e instanceof AppError && (e.statusCode === 409 || e.statusCode === 410)) return send(reply, e.statusCode, gonePage(e.message, 'لا يمكن تعديل المراجعة بعد إرسالها.'));
      throw e;
    }
    return reply.redirect(`/m/${encodeURIComponent(token)}`, 303);
  });
}
