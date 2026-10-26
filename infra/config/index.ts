import { production } from './production';
import { staging } from './staging';
import type { EnvName, QitahConfig } from './types';

export type { EnvName, QitahConfig } from './types';

export const CONFIGS: Record<EnvName, QitahConfig> = { staging, production };
export const ENV_NAMES: EnvName[] = ['staging', 'production'];

const ACCOUNT_RE = /^\d{12}$/;

type ContextReader = (key: string) => unknown;

/**
 * Resolves the AWS account for an environment WITHOUT needing credentials. Order:
 *   1. `-c <env>Account=123456789012` (e.g. `-c stagingAccount=...`)
 *   2. `-c account=123456789012`
 *   3. `QITAH_<ENV>_ACCOUNT` environment variable (e.g. QITAH_PRODUCTION_ACCOUNT)
 *   4. `CDK_DEFAULT_ACCOUNT` (set by the CDK CLI when credentials are available)
 */
export function resolveAccount(envName: EnvName, ctx: ContextReader, env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    ctx(`${envName}Account`),
    ctx('account'),
    env[`QITAH_${envName.toUpperCase()}_ACCOUNT`],
    env.CDK_DEFAULT_ACCOUNT,
  ];
  const account = candidates.find((c) => typeof c === 'string' && c.length > 0) as string | undefined;
  if (!account) {
    throw new Error(
      `No AWS account id for ${envName}. Pass -c ${envName}Account=<12 digits> (or -c account=...), ` +
        `set QITAH_${envName.toUpperCase()}_ACCOUNT, or run with credentials so CDK_DEFAULT_ACCOUNT is set.`,
    );
  }
  if (!ACCOUNT_RE.test(account)) throw new Error(`Invalid AWS account id for ${envName}: "${account}"`);
  return account;
}

/** Returns the config with context overrides applied (`-c region=`, `-c <env>Region=`, `-c alarmEmail=`). */
export function resolveConfig(envName: EnvName, ctx: ContextReader): QitahConfig {
  const base = CONFIGS[envName];
  const region = (ctx(`${envName}Region`) as string | undefined) ?? (ctx('region') as string | undefined) ?? base.region;
  const alarmEmail = (ctx(`${envName}AlarmEmail`) as string | undefined) ?? (ctx('alarmEmail') as string | undefined);
  return {
    ...base,
    region,
    monitoring: { ...base.monitoring, alarmEmails: alarmEmail ? alarmEmail.split(',').map((s) => s.trim()) : base.monitoring.alarmEmails },
  };
}

/** Which environments to synthesize: `-c env=staging|production`, default both. */
export function selectedEnvs(ctx: ContextReader): EnvName[] {
  const sel = ctx('env');
  if (sel === undefined) return ENV_NAMES;
  if (sel === 'staging' || sel === 'production') return [sel];
  throw new Error(`Unknown -c env=${String(sel)} (expected staging or production)`);
}
