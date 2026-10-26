import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { deliverInProcess, type Deps } from '../app.js';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { parse } from '../lib/http.js';
import { paymentWebhook } from '../services/sandboxDelivery.js';

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const sar = (h: number) => (h / 100).toFixed(2);

function page(title: string, body: string) {
  return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#F5F7FA;color:#0B1B33;margin:0;padding:24px}main{max-width:420px;margin:auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 1px 3px #0001}
.banner{background:#FFF4D6;color:#7A4B00;border-radius:10px;padding:10px 12px;font-size:14px;margin-bottom:16px}h1{font-size:20px;margin:0 0 4px}.amount{font-size:32px;font-weight:700;margin:16px 0}
button{width:100%;padding:14px;border:0;border-radius:12px;font-size:16px;margin-top:10px;cursor:pointer}.pay{background:#0047BA;color:#fff}.fail{background:#EEF1F6;color:#0B1B33}
a{color:#0047BA}.muted{color:#5B6B82;font-size:14px}.label{border:2px dashed #0B1B33;padding:16px;border-radius:8px}.big{font-family:ui-monospace,monospace;font-size:22px;letter-spacing:2px}</style></head><body><main>${body}</main></body></html>`;
}

/** SANDBOX hosted payment page + sandbox shipping labels. Registered only when sandbox providers are active. */
export async function sandboxRoutes(app: FastifyInstance, deps: Deps) {
  const { ctx } = deps;

  app.get('/sandbox/pay/:providerPaymentId', async (req, reply) => {
    const { providerPaymentId } = parse(z.object({ providerPaymentId: z.string().max(80) }), req.params);
    const payment = await prisma.payment.findFirst({ where: { providerPaymentId }, include: { order: true } });
    if (!payment) throw notFound('Payment');
    const done = payment.status !== 'INITIATED';
    reply.type('text/html').send(
      page(
        'Qitah Sandbox Payment',
        `<div class="banner">بيئة تجريبية — لن يتم خصم أي مبلغ حقيقي · SANDBOX — no real money moves</div>
<h1>الدفع للطلب ${esc(payment.order.number)}</h1><div class="muted">طريقة الدفع: ${esc(payment.method)}</div>
<div class="amount">${sar(payment.amountHalalas)} ر.س</div>
${
  done
    ? `<p>حالة الدفع: <b>${esc(payment.status)}</b></p><p><a href="qitah://checkout/return?order=${esc(payment.orderId)}">العودة إلى تطبيق قطعة</a></p>`
    : `<form method="post"><input type="hidden" name="outcome" value="success"><button class="pay">ادفع (محاكاة نجاح)</button></form>
<form method="post"><input type="hidden" name="outcome" value="fail"><button class="fail">رفض البطاقة (محاكاة فشل)</button></form>`
}`,
      ),
    );
  });

  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body as string)));
  });

  app.post('/sandbox/pay/:providerPaymentId', async (req, reply) => {
    const { providerPaymentId } = parse(z.object({ providerPaymentId: z.string().max(80) }), req.params);
    const { outcome } = parse(z.object({ outcome: z.enum(['success', 'fail']) }), req.body);
    const payment = await prisma.payment.findFirst({ where: { providerPaymentId } });
    if (!payment) throw notFound('Payment');
    // The page asks the "PSP" to notify Qitah through the signed webhook — the order is never updated directly here.
    await deliverInProcess(
      app,
      paymentWebhook(ctx.config.PAYMENT_WEBHOOK_SECRET, {
        type: outcome === 'success' ? 'payment.captured' : 'payment.failed',
        providerPaymentId,
        amountHalalas: payment.amountHalalas,
        ...(outcome === 'fail' ? { failureReason: 'SANDBOX_DECLINED' } : {}),
      }),
    );
    reply.redirect(`/sandbox/pay/${providerPaymentId}`, 303);
  });

  app.get('/sandbox/labels/:shipmentId', async (req, reply) => {
    const { shipmentId } = parse(z.object({ shipmentId: z.string().max(64) }), req.params);
    const s = await prisma.shipment.findUnique({ where: { id: shipmentId }, include: { originLocation: true, order: true, merchantOrder: { include: { merchant: true } } } });
    if (!s || !s.trackingNumber) throw notFound('Label');
    const a = s.order.addressSnapshot as Record<string, string>;
    reply.type('text/html').send(
      page(
        'Sandbox label',
        `<div class="banner">SANDBOX LABEL — NOT VALID FOR SHIPPING · بوليصة تجريبية غير صالحة للشحن</div>
<div class="label"><div class="muted">${esc(s.carrierCode)} · ${esc(s.serviceCode)} · ${s.direction}</div><div class="big">${esc(s.trackingNumber)}</div>
<p><b>من:</b> ${esc(s.merchantOrder.merchant.displayNameAr)} — ${esc(s.originLocation.name)}، ${esc(s.originLocation.district)}، ${esc(s.originLocation.city)}</p>
<p><b>إلى:</b> ${esc(a.contactName)} — ${esc(a.district)}، ${esc(a.city)}</p>
<p class="muted">مرجع: ${esc(s.merchantOrder.number)} · الوزن ${(s.weightGrams / 1000).toFixed(1)} كجم</p></div>`,
      ),
    );
  });
}
