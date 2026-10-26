import * as ecs from 'aws-cdk-lib/aws-ecs';
import type * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

import type { QitahConfig } from '../config';

export interface DatabaseEnvProps {
  config: QitahConfig;
  dbSecret: secretsmanager.ISecret;
}

/**
 * DB connection parts injected from the RDS-generated Secrets Manager secret. The image entrypoint
 * (services/api/docker/entrypoint.sh) composes DATABASE_URL with a URL-encoded password and
 * `sslmode=require` (the parameter group sets rds.force_ssl=1). Never passed as plain env.
 */
export function databaseSecrets(dbSecret: secretsmanager.ISecret): Record<string, ecs.Secret> {
  return {
    DB_HOST: ecs.Secret.fromSecretsManager(dbSecret, 'host'),
    DB_PORT: ecs.Secret.fromSecretsManager(dbSecret, 'port'),
    DB_USER: ecs.Secret.fromSecretsManager(dbSecret, 'username'),
    DB_PASSWORD: ecs.Secret.fromSecretsManager(dbSecret, 'password'),
  };
}

export function databaseEnvironment(config: QitahConfig): Record<string, string> {
  return {
    DB_NAME: config.database.databaseName,
    DB_SSLMODE: 'require',
    DB_SCHEMA: 'public',
  };
}

/** Webhook secrets from the application secret. */
export function appSecrets(appSecret: secretsmanager.ISecret): Record<string, ecs.Secret> {
  return {
    PAYMENT_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(appSecret, 'PAYMENT_WEBHOOK_SECRET'),
    CARRIER_WEBHOOK_SECRET: ecs.Secret.fromSecretsManager(appSecret, 'CARRIER_WEBHOOK_SECRET'),
  };
}

export interface AppEnvironmentProps {
  config: QitahConfig;
  publicBaseUrl: string;
  cognitoUserPoolId: string;
  cognitoUserPoolIds: string[];
  cognitoClientIds: string[];
  jobsQueueUrl: string;
  uploadsBucketName: string;
}

/**
 * Non-secret environment for the API and worker, mirroring services/api/src/config.ts.
 * JWT_SECRET is intentionally absent: AWS environments run AUTH_MODE=cognito.
 */
export function appEnvironment(p: AppEnvironmentProps): Record<string, string> {
  const c = p.config;
  const env: Record<string, string> = {
    NODE_ENV: c.app.nodeEnv,
    HOST: '0.0.0.0',
    PORT: '4000',
    PUBLIC_BASE_URL: p.publicBaseUrl,
    AUTH_MODE: 'cognito',
    COGNITO_REGION: c.region,
    COGNITO_USER_POOL_ID: p.cognitoUserPoolId,
    // Forward-compatible: the API verifies a single issuer today (see REGION/DEPLOYMENT docs).
    COGNITO_USER_POOL_IDS: p.cognitoUserPoolIds.join(','),
    COGNITO_CLIENT_IDS: p.cognitoClientIds.join(','),
    PAYMENT_PROVIDER: 'sandbox',
    CARRIER_PROVIDER: 'sandbox',
    ALLOW_SANDBOX_IN_PRODUCTION: String(c.app.allowSandboxInProduction),
    CORS_ORIGINS: c.app.corsOrigins.join(','),
    JOBS_QUEUE_URL: p.jobsQueueUrl,
    UPLOADS_BUCKET: p.uploadsBucketName,
    AWS_REGION: c.region,
    ...databaseEnvironment(c),
  };
  if (c.app.reservationMinutes) env.RESERVATION_MINUTES = String(c.app.reservationMinutes);
  if (c.app.returnWindowDays) env.RETURN_WINDOW_DAYS = String(c.app.returnWindowDays);
  return env;
}

export function runtimePlatform(config: QitahConfig): ecs.RuntimePlatform {
  return {
    operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
    cpuArchitecture: config.compute.cpuArchitecture === 'ARM64' ? ecs.CpuArchitecture.ARM64 : ecs.CpuArchitecture.X86_64,
  };
}

/** Image tag from `-c imageTag=<git sha>`. */
export const IMAGE_TAG_PLACEHOLDER = 'image-tag-not-set';
