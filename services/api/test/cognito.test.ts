import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from 'jose';

import { createTokenService } from '../src/auth/tokens.js';
import { loadConfig } from '../src/config.js';

test('cognito mode accepts tokens from both configured pools and only known clients', async () => {
  const config = loadConfig({
    DATABASE_URL: 'postgresql://x', PAYMENT_WEBHOOK_SECRET: 'x'.repeat(16), CARRIER_WEBHOOK_SECRET: 'x'.repeat(16),
    AUTH_MODE: 'cognito', COGNITO_REGION: 'eu-central-1', COGNITO_USER_POOL_IDS: 'eu-central-1_CUST,eu-central-1_STAFF', COGNITO_CLIENT_IDS: 'mobile,merchant',
  });
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'RS256' };
  const tokens = createTokenService(config, () => createLocalJWKSet({ keys: [jwk] }));
  const sign = (pool: string, claims: Record<string, unknown>) =>
    new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: 'k1' }).setIssuer(`https://cognito-idp.eu-central-1.amazonaws.com/${pool}`).setSubject('sub-1').setIssuedAt().setExpirationTime('5m').sign(privateKey);

  const customer = await tokens.verify(await sign('eu-central-1_CUST', { token_use: 'access', client_id: 'mobile', phone_number: '+966500000001' }));
  assert.equal(customer.issuer, 'cognito');
  const staff = await tokens.verify(await sign('eu-central-1_STAFF', { token_use: 'id', aud: 'merchant', email: 'a@b.c', email_verified: true }));
  assert.equal(staff.email, 'a@b.c');
  await assert.rejects(tokens.verify(await sign('eu-central-1_OTHER', { token_use: 'access', client_id: 'mobile' })));
  await assert.rejects(tokens.verify(await sign('eu-central-1_CUST', { token_use: 'access', client_id: 'evil' })));
  await assert.rejects(tokens.verify(await sign('eu-central-1_CUST', { token_use: 'refresh', client_id: 'mobile' })));
});
