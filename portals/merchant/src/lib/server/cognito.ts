import { createHmac } from "node:crypto";

import { serverConfig } from "./config";

/**
 * Minimal Amazon Cognito client (USER_PASSWORD_AUTH / REFRESH_TOKEN_AUTH / RevokeToken) over the
 * public JSON API, so the portal needs no AWS SDK. Calls are made server-side only.
 *
 * The Qitah API accepts Cognito ID tokens (aud = app client id) and resolves the user by `sub`,
 * linking to an existing merchant user by verified email on first sign-in.
 */

export class CognitoError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

type AuthResult = { IdToken?: string; AccessToken?: string; RefreshToken?: string; ExpiresIn?: number };

async function call<T>(target: string, body: Record<string, unknown>): Promise<T> {
  const { region } = serverConfig.cognito();
  const res = await fetch(`https://cognito-idp.${region}.amazonaws.com/`, {
    method: "POST",
    headers: { "content-type": "application/x-amz-json-1.1", "x-amz-target": `AWSCognitoIdentityProviderService.${target}` },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const type = String(json.__type ?? "CognitoError").split("#").pop() ?? "CognitoError";
    const message = String(json.message ?? json.Message ?? "Cognito request failed");
    // Wrong credentials, unknown user and unconfirmed users all map to 401 without detail.
    const authFailure = ["NotAuthorizedException", "UserNotFoundException", "UserNotConfirmedException", "PasswordResetRequiredException"].includes(type);
    throw new CognitoError(authFailure ? 401 : res.status >= 500 ? 502 : 400, authFailure ? "UNAUTHENTICATED" : type, authFailure ? "Incorrect email or password" : message);
  }
  return json as T;
}

function secretHash(username: string): string | undefined {
  const { clientId, clientSecret } = serverConfig.cognito();
  if (!clientSecret) return undefined;
  return createHmac("sha256", clientSecret).update(username + clientId).digest("base64");
}

/** The `cognito:username` claim, needed for SECRET_HASH on refresh when the client has a secret. */
function usernameFromIdToken(idToken: string): string | undefined {
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as Record<string, unknown>;
    return (payload["cognito:username"] as string | undefined) ?? (payload.sub as string | undefined);
  } catch {
    return undefined;
  }
}

export type CognitoTokens = { accessToken: string; refreshToken: string; expiresIn: number };

export async function cognitoLogin(email: string, password: string): Promise<CognitoTokens> {
  const { clientId } = serverConfig.cognito();
  const hash = secretHash(email);
  const out = await call<{ AuthenticationResult?: AuthResult; ChallengeName?: string }>("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: clientId,
    AuthParameters: { USERNAME: email, PASSWORD: password, ...(hash ? { SECRET_HASH: hash } : {}) },
  });
  if (out.ChallengeName || !out.AuthenticationResult?.IdToken || !out.AuthenticationResult.RefreshToken) {
    // NEW_PASSWORD_REQUIRED, MFA, etc. are not handled by the portal yet.
    throw new CognitoError(401, "CHALLENGE_REQUIRED", `Additional sign-in step required (${out.ChallengeName ?? "unknown"})`);
  }
  const r = out.AuthenticationResult;
  // The ID token is what the Qitah API verifies (it carries the verified email used for account linking).
  return { accessToken: r.IdToken!, refreshToken: r.RefreshToken!, expiresIn: r.ExpiresIn ?? 3600 };
}

export async function cognitoRefresh(refreshToken: string, previousIdToken?: string): Promise<CognitoTokens> {
  const { clientId, clientSecret } = serverConfig.cognito();
  const username = previousIdToken ? usernameFromIdToken(previousIdToken) : undefined;
  if (clientSecret && !username) throw new CognitoError(401, "UNAUTHENTICATED", "Session expired");
  const hash = username ? secretHash(username) : undefined;
  const out = await call<{ AuthenticationResult?: AuthResult }>("InitiateAuth", {
    AuthFlow: "REFRESH_TOKEN_AUTH",
    ClientId: clientId,
    AuthParameters: { REFRESH_TOKEN: refreshToken, ...(hash ? { SECRET_HASH: hash } : {}) },
  });
  const r = out.AuthenticationResult;
  if (!r?.IdToken) throw new CognitoError(401, "UNAUTHENTICATED", "Session expired");
  // Cognito keeps the same refresh token unless refresh-token rotation is enabled on the client.
  return { accessToken: r.IdToken, refreshToken: r.RefreshToken ?? refreshToken, expiresIn: r.ExpiresIn ?? 3600 };
}

export async function cognitoRevoke(refreshToken: string): Promise<void> {
  const { clientId, clientSecret } = serverConfig.cognito();
  await call("RevokeToken", { Token: refreshToken, ClientId: clientId, ...(clientSecret ? { ClientSecret: clientSecret } : {}) });
}
