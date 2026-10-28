import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import type { Deps } from '../app.js';
import { AppError } from '../lib/errors.js';
import { parse, rateLimit } from '../lib/http.js';
import { convertWorkshopQuote, findQuoteByToken, respondToQuote, type QuoteLine, type QuoteVehicle } from '../services/workshopQuotes.js';
import { esc, page, send } from './mechanic.js';

/**
 * Public workshop→customer quote page (/q/:token): no account, Arabic RTL, no JavaScript, noindex, no-store,
 * no referrer. Shows only what the workshop typed (vehicle, parts, labour, its fee, note) and the workshop's name.
 * The customer's phone is never rendered. Everything user-supplied is HTML-escaped.
 */

const CONDITION: Record<string, string> = { NEW: 'جديد', USED: 'مستعمل', REFURBISHED: 'مجدد' };
const sar = (h: number) => `${(h / 100).toFixed(2)} ر.س`;

type Loaded = NonNullable<Awaited<ReturnType<typeof findQuoteByToken>>>;

function body(q: Loaded, form: boolean, error?: string) {
  const v = q.vehicle as unknown as QuoteVehicle;
  const lines = (q.lines as unknown as QuoteLine[])
    .map(
      (l) => `<div class="row" style="justify-content:space-between;border-bottom:1px solid #EEF1F6;padding:6px 0"><div><b>${esc(l.nameAr)}</b> <span class="muted">× ${esc(l.quantity)}</span>
<div class="muted">${esc(l.brand)} · <span class="ltr">${esc(l.partNumber)}</span> · ${esc(CONDITION[l.condition] ?? l.condition)}</div></div><div class="ltr">${esc(sar(l.unitPriceHalalas * l.quantity))}</div></div>`,
    )
    .join('');
  const status =
    q.status === 'APPROVED' || q.status === 'CONVERTED'
      ? '<div class="card"><span class="tag ok">تم اعتماد العرض ✔</span><div class="muted">أبلغنا الورشة باعتمادك، وستتواصل معك لموعد التركيب.</div></div>'
      : q.status === 'DECLINED'
        ? '<div class="card"><span class="tag warn">تم رفض العرض</span><div class="muted">أبلغنا الورشة برفضك للعرض.</div></div>'
        : '';
  const actions = form
    ? `<form method="post"><div class="card"><div class="muted" style="margin-bottom:8px">باعتمادك للعرض تؤكد للورشة طلب القطع وتنفيذ العمل. الدفع يتم مباشرة مع الورشة.</div>
<div class="choice"><label><input type="radio" name="decision" value="approve" required> أعتمد العرض</label><label><input type="radio" name="decision" value="decline"> لا أرغب</label></div>
<button type="submit">إرسال</button></div></form>
<p class="muted" style="text-align:center">ينتهي هذا العرض في ${esc(q.expiresAt.toISOString().slice(0, 16).replace('T', ' '))} UTC</p>`
    : '';
  return `<div class="card"><div class="brand">قطعة</div><h1>عرض سعر من ${esc(q.org.displayName)}</h1><div class="muted">رقم العرض <span class="ltr">${esc(q.number)}</span> · ${esc(q.org.district)}</div></div>
${error ? `<div class="err">${esc(error)}</div>` : ''}${status}
<div class="card"><h2>السيارة</h2><div><b>${esc(v.model)}${v.year ? ` ${esc(v.year)}` : ''}</b></div>
${v.plate ? `<div class="muted">اللوحة: <span class="ltr">${esc(v.plate)}</span></div>` : ''}${v.vin ? `<div class="muted">رقم الهيكل (VIN): <span class="ltr">${esc(v.vin)}</span></div>` : ''}</div>
<div class="card"><h2>القطع (بأسعار قطعة)</h2>${lines}
<div class="row" style="justify-content:space-between;padding:6px 0"><span>مجموع القطع</span><span class="ltr">${esc(sar(q.partsHalalas))}</span></div>
<div class="row" style="justify-content:space-between;padding:6px 0"><span>أجرة اليد</span><span class="ltr">${esc(sar(q.laborHalalas))}</span></div>
<div class="row" style="justify-content:space-between;padding:6px 0"><span>رسوم الورشة</span><span class="ltr">${esc(sar(q.markupHalalas))}</span></div>
<div class="row" style="justify-content:space-between;padding:8px 0;font-size:18px"><b>الإجمالي</b><b class="ltr">${esc(sar(q.totalHalalas))}</b></div>
<div class="muted">الأسعار شاملة ضريبة القيمة المضافة.</div></div>
${q.note ? `<div class="card"><b>ملاحظة الورشة:</b> ${esc(q.note)}</div>` : ''}${actions}`;
}

const gone = (title: string, text: string) => page(title, `<div class="card"><div class="brand">قطعة</div><h1>${esc(title)}</h1><div class="muted">${esc(text)}</div></div>`);

export async function workshopQuotePublicRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8 * 1024 }, (_req, b, done) => {
    done(null, Object.fromEntries(new URLSearchParams(b as string)));
  });
  const tokenParam = z.object({ token: z.string().max(120) });

  app.get('/q/:token', rateLimit(ctx.config.RATE_LIMIT_SCALE, 60, '1 minute'), async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const q = await findQuoteByToken(token);
    if (!q) return send(reply, 404, gone('الرابط غير صالح', 'تأكد من نسخ الرابط كاملاً من رسالة الورشة.'));
    if (q.status === 'EXPIRED') return send(reply, 410, gone('انتهت صلاحية العرض', 'اطلب من الورشة إرسال عرض جديد.'));
    return send(reply, 200, page(`عرض سعر — ${q.org.displayName}`, body(q, q.status === 'SENT')));
  });

  app.post('/q/:token', rateLimit(ctx.config.RATE_LIMIT_SCALE, 10, '1 minute'), async (req, reply) => {
    const { token } = parse(tokenParam, req.params);
    const q = await findQuoteByToken(token);
    if (!q) return send(reply, 404, gone('الرابط غير صالح', 'تأكد من نسخ الرابط كاملاً من رسالة الورشة.'));
    if (q.status === 'EXPIRED') return send(reply, 410, gone('انتهت صلاحية العرض', 'اطلب من الورشة إرسال عرض جديد.'));
    if (q.status !== 'SENT') return send(reply, 409, page('تم الرد على العرض', body(q, false)));
    const form = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string | undefined>;
    const decision = form.decision;
    if (decision !== 'approve' && decision !== 'decline') return send(reply, 400, page('عرض سعر', body(q, true, 'اختر «أعتمد العرض» أو «لا أرغب»')));
    try {
      await respondToQuote(q, decision);
    } catch (e) {
      if (e instanceof AppError && (e.statusCode === 409 || e.statusCode === 410)) return send(reply, e.statusCode, gone(e.message, 'لا يمكن تغيير الرد بعد إرساله.'));
      throw e;
    }
    if (decision === 'approve') {
      // Best effort: a failed conversion leaves the quote APPROVED with convertError; the workshop retries in the app.
      await convertWorkshopQuote(ctx, q.id).catch((e) => req.log.warn({ err: e, quoteId: q.id }, 'workshop quote conversion failed'));
    }
    return reply.redirect(`/q/${encodeURIComponent(token)}`, 303);
  });
}
