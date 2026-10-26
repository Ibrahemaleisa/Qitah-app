import 'server-only';

/**
 * Server-only configuration. None of these values are exposed to the browser
 * (no NEXT_PUBLIC_ prefix); the browser only ever talks to this app's own origin.
 */
export type AuthMode = 'local' | 'cognito';

function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export function serverConfig() {
  const authMode = (process.env.AUTH_MODE ?? 'local') as AuthMode;
  if (authMode !== 'local' && authMode !== 'cognito') throw new Error('AUTH_MODE must be "local" or "cognito"');
  const production = process.env.NODE_ENV === 'production';
  return {
    apiBaseUrl: required('API_BASE_URL').replace(/\/+$/, ''),
    authMode,
    production,
    /** Secure cookies in production; can be forced on for staging behind TLS. */
    secureCookies: production || process.env.COOKIE_SECURE === 'true',
    /** Optional explicit public origin(s) for the CSRF Origin check (comma-separated). Defaults to the request's own origin. */
    allowedOrigins: (process.env.APP_ORIGIN ?? '').split(',').map((s) => s.trim().replace(/\/+$/, '')).filter(Boolean),
    cognito: {
      region: process.env.COGNITO_REGION ?? '',
      clientId: process.env.COGNITO_CLIENT_ID ?? '',
      clientSecret: process.env.COGNITO_CLIENT_SECRET ?? '',
    },
  };
}

export const COOKIE = {
  access: 'qops_at',
  refresh: 'qops_rt',
  /** Cognito username (needed to compute SECRET_HASH on refresh for clients with a secret). */
  cognitoUser: 'qops_cu',
} as const;
