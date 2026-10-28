import { z } from 'zod';

const bool = z.enum(['true', 'false']).default('false').transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z.string().min(1),
  PUBLIC_BASE_URL: z.string().url().default('http://127.0.0.1:4000'),
  AUTH_MODE: z.enum(['local', 'cognito']).default('local'),
  JWT_SECRET: z.string().min(32).optional(),
  COGNITO_REGION: z.string().optional(),
  COGNITO_USER_POOL_ID: z.string().optional(),
  /** Comma-separated pool ids (customer pool + staff/merchant pool). Takes precedence over COGNITO_USER_POOL_ID. */
  COGNITO_USER_POOL_IDS: z.string().optional(),
  COGNITO_CLIENT_IDS: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  CARRIER_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  CARRIER_WEBHOOK_SECRET: z.string().min(16),
  ALLOW_SANDBOX_IN_PRODUCTION: bool,
  CORS_ORIGINS: z.string().default(''),
  JOBS_QUEUE_URL: z.string().optional(),
  /** Private S3 bucket for documents; empty = local disk (sandbox/dev only). */
  UPLOADS_BUCKET: z.string().optional(),
  LOCAL_UPLOADS_DIR: z.string().optional(),
  AWS_REGION: z.string().default('me-central-1'),
  RESERVATION_MINUTES: z.coerce.number().int().positive().default(30),
  RETURN_WINDOW_DAYS: z.coerce.number().int().positive().default(7),
  /** Multiplies per-route rate limits (tests/load tests raise it; never lower than 1 in production). */
  /** Number of trusted reverse-proxy hops in front of the API (CloudFront → ALB = 2). */
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(10_000).default(1),

  // ── merchant economics (README.md § Merchant economics)
  /** Commission when no CommissionRule matches and the merchant has no negotiated rate. */
  COMMISSION_DEFAULT_BPS: z.coerce.number().int().min(0).max(5000).default(1000),
  /** Payment-provider fee table per method (bps of the captured amount). Sandbox fees are recorded as estimates. */
  PAYMENT_FEE_BPS_MADA: z.coerce.number().int().min(0).max(1000).default(80),
  PAYMENT_FEE_BPS_CARD: z.coerce.number().int().min(0).max(1000).default(200),
  PAYMENT_FEE_BPS_APPLE_PAY: z.coerce.number().int().min(0).max(1000).default(200),
  PAYMENT_FEE_BPS_STC_PAY: z.coerce.number().int().min(0).max(1000).default(150),
  /** WEEKLY settlement run day, Riyadh time (0 = Sunday … 6 = Saturday). */
  SETTLEMENT_WEEKDAY: z.coerce.number().int().min(0).max(6).default(0),
  /** Share of an early (DAILY, trusted) payout withheld in MERCHANT_RESERVE until the return window closes. */
  SETTLEMENT_RESERVE_BPS: z.coerce.number().int().min(0).max(10_000).default(1000),
  /** Offer freshness: stale (flagged, ranked lower) after N days without confirmation, hidden after M days. */
  FRESHNESS_STALE_DAYS: z.coerce.number().int().positive().default(7),
  FRESHNESS_HIDE_DAYS: z.coerce.number().int().positive().default(21),
  /** Accept SLA for merchant orders shipped same-day (capped; the merchant's own SLA applies when shorter). */
  SLA_SAME_DAY_ACCEPT_MINUTES: z.coerce.number().int().min(5).max(240).default(15),
});

export type Config = z.infer<typeof schema> & { sandbox: boolean };

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.parse(env);
  const sandbox = parsed.PAYMENT_PROVIDER === 'sandbox' || parsed.CARRIER_PROVIDER === 'sandbox';
  if (parsed.NODE_ENV === 'production' && sandbox && !parsed.ALLOW_SANDBOX_IN_PRODUCTION) {
    throw new Error('Refusing to start: sandbox payment/carrier providers are not allowed in production');
  }
  if (parsed.AUTH_MODE === 'local' && !parsed.JWT_SECRET) throw new Error('JWT_SECRET is required for AUTH_MODE=local');
  if (parsed.NODE_ENV === 'production' && parsed.AUTH_MODE === 'local') {
    throw new Error('Refusing to start: AUTH_MODE=local is not allowed in production (use cognito)');
  }
  if (parsed.FRESHNESS_HIDE_DAYS < parsed.FRESHNESS_STALE_DAYS) throw new Error('FRESHNESS_HIDE_DAYS must be ≥ FRESHNESS_STALE_DAYS');
  if (parsed.NODE_ENV === 'production' && !parsed.UPLOADS_BUCKET) throw new Error('UPLOADS_BUCKET is required in production');
  if (parsed.AUTH_MODE === 'cognito' && !(parsed.COGNITO_REGION && (parsed.COGNITO_USER_POOL_IDS || parsed.COGNITO_USER_POOL_ID) && parsed.COGNITO_CLIENT_IDS)) {
    throw new Error('COGNITO_REGION, COGNITO_USER_POOL_IDS (or COGNITO_USER_POOL_ID) and COGNITO_CLIENT_IDS are required for AUTH_MODE=cognito');
  }
  return { ...parsed, sandbox };
}
