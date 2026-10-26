import 'server-only';

import { createHmac } from 'node:crypto';

import { serverConfig } from './config';

/**
 * Minimal server-side Amazon Cognito client (no SDK): InitiateAuth over the public JSON API.
 * USER_PASSWORD_AUTH must be enabled on the app client. If the client has a secret, set
 * COGNITO_CLIENT_SECRET and SECRET_HASH is computed here (the secret never reaches the browser).
 *
 * NOTE: not exercised in this repository's sandbox (no Cognito user pool available).
 */
export type CognitoTokens = { idToken: string; refreshToken?: string; expiresIn: number; username: string };

export class CognitoAuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

function secretHash(username: string, clientId: string, secret: string) {
  return createHmac('sha256', secret).update(username + clientId).digest('base64');
}

/** Reads `cognito:username` from an ID token we just received from Cognito over TLS (not used for authorization). */
function usernameFromIdToken(idToken: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;
    return (payload['cognito:username'] as string | undefined) ?? (payload.sub as string | undefined);
  } catch {
    return undefined;
  }
}

async function initiateAuth(flow: 'USER_PASSWORD_AUTH' | 'REFRESH_TOKEN_AUTH', params: Record<string, string>) {
  const { cognito } = serverConfig();
  if (!cognito.region || !cognito.clientId) throw new Error('COGNITO_REGION and COGNITO_CLIENT_ID are required for AUTH_MODE=cognito');
  const res = await fetch(`https://cognito-idp.${cognito.region}.amazonaws.com/`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-amz-json-1.1', 'x-amz-target': 'AWSCognitoIdentityProviderService.InitiateAuth' },
    body: JSON.stringify({ AuthFlow: flow, ClientId: cognito.clientId, AuthParameters: params }),
    cache: 'no-store',
  });
  const body = (await res.json().catch(() => ({}))) as {
    __type?: string;
    message?: string;
    ChallengeName?: string;
    AuthenticationResult?: { IdToken: string; RefreshToken?: string; ExpiresIn: number };
  };
  if (!res.ok) {
    const code = (body.__type ?? 'CognitoError').split('#').pop()!;
    throw new CognitoAuthError(code, body.message ?? 'Cognito sign-in failed');
  }
  if (body.ChallengeName || !body.AuthenticationResult) {
    // MFA / NEW_PASSWORD_REQUIRED etc. are not supported by this portal's login form yet.
    throw new CognitoAuthError('ChallengeRequired', `Cognito challenge not supported: ${body.ChallengeName ?? 'unknown'}`);
  }
  return body.AuthenticationResult;
}

export async function cognitoPasswordLogin(email: string, password: string): Promise<CognitoTokens> {
  const { cognito } = serverConfig();
  const params: Record<string, string> = { USERNAME: email, PASSWORD: password };
  if (cognito.clientSecret) params.SECRET_HASH = secretHash(email, cognito.clientId, cognito.clientSecret);
  const r = await initiateAuth('USER_PASSWORD_AUTH', params);
  return { idToken: r.IdToken, refreshToken: r.RefreshToken, expiresIn: r.ExpiresIn, username: usernameFromIdToken(r.IdToken) ?? email };
}

export async function cognitoRefresh(refreshToken: string, username: string | undefined): Promise<CognitoTokens> {
  const { cognito } = serverConfig();
  const params: Record<string, string> = { REFRESH_TOKEN: refreshToken };
  if (cognito.clientSecret) {
    if (!username) throw new CognitoAuthError('NotAuthorizedException', 'Missing username for SECRET_HASH');
    params.SECRET_HASH = secretHash(username, cognito.clientId, cognito.clientSecret);
  }
  const r = await initiateAuth('REFRESH_TOKEN_AUTH', params);
  // Cognito does not rotate refresh tokens on REFRESH_TOKEN_AUTH unless rotation is enabled; keep the old one otherwise.
  return { idToken: r.IdToken, refreshToken: r.RefreshToken ?? refreshToken, expiresIn: r.ExpiresIn, username: username ?? usernameFromIdToken(r.IdToken) ?? '' };
}
