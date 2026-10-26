import { createRemoteJWKSet, jwtVerify, SignJWT, type JWTPayload } from 'jose';

import type { Config } from '../config.js';

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 30;

export type VerifiedToken = {
  issuer: 'local' | 'cognito';
  subject: string;
  email?: string;
  phone?: string;
};

export function createTokenService(config: Config) {
  const secret = config.JWT_SECRET ? new TextEncoder().encode(config.JWT_SECRET) : undefined;
  const cognitoIssuer =
    config.AUTH_MODE === 'cognito'
      ? `https://cognito-idp.${config.COGNITO_REGION}.amazonaws.com/${config.COGNITO_USER_POOL_ID}`
      : undefined;
  const jwks = cognitoIssuer ? createRemoteJWKSet(new URL(`${cognitoIssuer}/.well-known/jwks.json`)) : undefined;
  const clientIds = (config.COGNITO_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean);

  async function signAccessToken(userId: string): Promise<string> {
    if (!secret) throw new Error('Local token signing is disabled');
    return new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer('qitah-local')
      .setAudience('qitah-api')
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(secret);
  }

  async function verify(token: string): Promise<VerifiedToken> {
    if (config.AUTH_MODE === 'local') {
      const { payload } = await jwtVerify(token, secret!, { issuer: 'qitah-local', audience: 'qitah-api', algorithms: ['HS256'] });
      return { issuer: 'local', subject: payload.sub! };
    }
    const { payload } = await jwtVerify(token, jwks!, { issuer: cognitoIssuer, algorithms: ['RS256'] });
    assertCognitoClient(payload, clientIds);
    return {
      issuer: 'cognito',
      subject: payload.sub!,
      email: payload.email_verified ? (payload.email as string | undefined) : undefined,
      phone: payload.phone_number_verified ? (payload.phone_number as string | undefined) : undefined,
    };
  }

  return { signAccessToken, verify };
}

/** Cognito ID tokens carry `aud`; access tokens carry `client_id`. Accept either for known clients only. */
export function assertCognitoClient(payload: JWTPayload, clientIds: string[]) {
  const use = payload.token_use;
  const client = use === 'access' ? payload.client_id : payload.aud;
  if ((use !== 'access' && use !== 'id') || typeof client !== 'string' || !clientIds.includes(client)) {
    throw new Error('Token was not issued for a Qitah client');
  }
}

export type TokenService = ReturnType<typeof createTokenService>;
