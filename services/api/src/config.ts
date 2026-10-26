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
  COGNITO_CLIENT_IDS: z.string().optional(),
  PAYMENT_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  PAYMENT_WEBHOOK_SECRET: z.string().min(16),
  CARRIER_PROVIDER: z.enum(['sandbox']).default('sandbox'),
  CARRIER_WEBHOOK_SECRET: z.string().min(16),
  ALLOW_SANDBOX_IN_PRODUCTION: bool,
  CORS_ORIGINS: z.string().default(''),
  JOBS_QUEUE_URL: z.string().optional(),
  AWS_REGION: z.string().default('me-central-1'),
  RESERVATION_MINUTES: z.coerce.number().int().positive().default(30),
  RETURN_WINDOW_DAYS: z.coerce.number().int().positive().default(7),
  /** Multiplies per-route rate limits (tests/load tests raise it; never lower than 1 in production). */
  RATE_LIMIT_SCALE: z.coerce.number().int().min(1).max(10_000).default(1),
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
  if (parsed.AUTH_MODE === 'cognito' && !(parsed.COGNITO_REGION && parsed.COGNITO_USER_POOL_ID && parsed.COGNITO_CLIENT_IDS)) {
    throw new Error('COGNITO_REGION, COGNITO_USER_POOL_ID and COGNITO_CLIENT_IDS are required for AUTH_MODE=cognito');
  }
  return { ...parsed, sandbox };
}
