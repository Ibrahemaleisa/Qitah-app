import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';

import { Client, login, prisma, resetDatabase, startApp } from './helpers.js';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  await resetDatabase();
  app = await startApp();
});
after(async () => {
  await app.close();
  await prisma.$disconnect();
});

test('refresh tokens rotate; replaying a rotated token revokes every session', async () => {
  const anon = new Client(app);
  const s1 = await anon.ok<any>('POST', '/v1/auth/login', { email: 'owner@eastern.qitah.test', password: 'Qitah-Sandbox-2026!' });
  const s2 = await anon.ok<any>('POST', '/v1/auth/refresh', { refreshToken: s1.refreshToken });
  assert.notEqual(s2.refreshToken, s1.refreshToken);
  const replay = await anon.post('/v1/auth/refresh', { refreshToken: s1.refreshToken });
  assert.equal(replay.status, 401);
  const afterTheft = await anon.post('/v1/auth/refresh', { refreshToken: s2.refreshToken });
  assert.equal(afterTheft.status, 401, 'the legitimate rotated token is revoked too');
  const wrong = await anon.post('/v1/auth/login', { email: 'nobody@qitah.test', password: 'whatever-123' });
  assert.equal(wrong.status, 401);
});

test('verification documents upload through signed URLs scoped to the merchant', async () => {
  const owner = await login(app, 'owner@new-applicant.qitah.test');
  const merchant = await prisma.merchant.findFirstOrThrow({ where: { status: 'UNDER_REVIEW' } });
  const bad = await owner.post(`/v1/merchants/${merchant.id}/uploads`, { purpose: 'verification', contentType: 'text/html', sizeBytes: 10, fileName: 'x.html' });
  assert.equal(bad.status, 400);
  const up = await owner.ok<any>('POST', `/v1/merchants/${merchant.id}/uploads`, { purpose: 'verification', contentType: 'application/pdf', sizeBytes: 9, fileName: 'CR certificate.pdf' });
  assert.ok(up.key.startsWith(`merchants/${merchant.id}/verification/`));
  const put = await app.inject({ method: 'PUT', url: new URL(up.uploadUrl).pathname + new URL(up.uploadUrl).search, payload: Buffer.from('%PDF-1.4\n'), headers: { 'content-type': 'application/pdf' } });
  assert.equal(put.statusCode, 200, put.body);
  const tampered = await app.inject({ method: 'PUT', url: new URL(up.uploadUrl).pathname + new URL(up.uploadUrl).search.replace('verification', 'other'), payload: Buffer.from('x'), headers: { 'content-type': 'application/pdf' } });
  assert.equal(tampered.statusCode, 403);
  await owner.ok('POST', `/v1/merchants/${merchant.id}/verification`, { documents: [{ type: 'CR', reference: '1010999999', fileKey: up.key }] });

  const ops = await login(app, 'ops.agent@qitah.test');
  const link = await ops.ok<any>('GET', `/v1/ops/uploads?key=${encodeURIComponent(up.key)}`);
  const file = await app.inject({ method: 'GET', url: new URL(link.url).pathname + new URL(link.url).search });
  assert.equal(file.statusCode, 200);
  assert.equal(file.body, '%PDF-1.4\n');

  const other = await login(app, 'owner@eastern.qitah.test');
  assert.equal((await other.get(`/v1/merchants/s-eastern/uploads?key=${encodeURIComponent(up.key)}`)).status, 404, 'cannot read another merchant file');
});

test('invalid status filters are ignored rather than crashing', async () => {
  const ops = await login(app, 'ops.admin@qitah.test');
  assert.equal((await ops.get('/v1/ops/orders?status=NOPE,PAID')).status, 200);
  assert.equal((await ops.get('/v1/ops/returns?status=bad')).status, 200);
});
