/**
 * Server-only configuration. Never import this module from a client component:
 * none of these values may reach the browser.
 */

export type AuthMode = "local" | "cognito";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export const serverConfig = {
  get apiBaseUrl(): string {
    return (process.env.API_BASE_URL ?? "http://127.0.0.1:4101").replace(/\/+$/, "");
  },
  get authMode(): AuthMode {
    return process.env.AUTH_MODE === "cognito" ? "cognito" : "local";
  },
  get cookieSecure(): boolean {
    if (process.env.COOKIE_SECURE === "false") return false;
    if (process.env.COOKIE_SECURE === "true") return true;
    return process.env.NODE_ENV === "production";
  },
  get allowedOrigins(): string[] {
    return (process.env.ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((s) => s.trim().replace(/\/+$/, ""))
      .filter(Boolean);
  },
  cognito() {
    return {
      region: required("COGNITO_REGION", process.env.COGNITO_REGION),
      clientId: required("COGNITO_CLIENT_ID", process.env.COGNITO_CLIENT_ID),
      clientSecret: process.env.COGNITO_CLIENT_SECRET || undefined,
    };
  },
};
