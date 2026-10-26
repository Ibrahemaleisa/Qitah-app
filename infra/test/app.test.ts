import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { resolveAccount, resolveConfig, selectedEnvs } from '../config';
import { QitahStage } from '../lib/stage';
import { ACCOUNTS, CDK_JSON_CONTEXT, IMAGE_TAG } from './helpers';

describe('config', () => {
  const ctx = (values: Record<string, unknown>) => (k: string) => values[k];

  test('account resolution order and validation (no credentials needed)', () => {
    expect(resolveAccount('staging', ctx({ stagingAccount: '123456789012', account: '999999999999' }), {})).toBe('123456789012');
    expect(resolveAccount('production', ctx({ account: '999999999999' }), {})).toBe('999999999999');
    expect(resolveAccount('production', ctx({}), { QITAH_PRODUCTION_ACCOUNT: '210987654321' })).toBe('210987654321');
    expect(resolveAccount('staging', ctx({}), { CDK_DEFAULT_ACCOUNT: '111122223333' })).toBe('111122223333');
    expect(() => resolveAccount('staging', ctx({}), {})).toThrow(/No AWS account id/);
    expect(() => resolveAccount('staging', ctx({ account: 'abc' }), {})).toThrow(/Invalid AWS account id/);
  });

  test('region and env selection are context-overridable', () => {
    expect(resolveConfig('production', ctx({ productionRegion: 'me-central-2' })).region).toBe('me-central-2');
    expect(resolveConfig('staging', ctx({})).region).toBe('eu-central-1');
    expect(selectedEnvs(ctx({}))).toEqual(['staging', 'production']);
    expect(selectedEnvs(ctx({ env: 'production' }))).toEqual(['production']);
    expect(() => selectedEnvs(ctx({ env: 'dev' }))).toThrow();
  });
});

describe('full app synthesis', () => {
  const outdir = fs.mkdtempSync(path.join(os.tmpdir(), 'qitah-cdk-'));
  const app = new App({ outdir, context: { ...CDK_JSON_CONTEXT, imageTag: IMAGE_TAG } });
  for (const env of ['staging', 'production'] as const) {
    new QitahStage(app, `Qitah-${env}`, { config: resolveConfig(env, () => undefined), account: ACCOUNTS[env], imageTag: IMAGE_TAG });
  }
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app));
  const assembly = app.synth();

  test('requires no context lookups (synth works without AWS credentials)', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(outdir, 'manifest.json'), 'utf8'));
    expect(manifest.missing ?? []).toEqual([]);
    for (const stageAsm of assembly.nestedAssemblies) {
      const m = JSON.parse(fs.readFileSync(path.join(stageAsm.nestedAssembly.directory, 'manifest.json'), 'utf8'));
      expect(m.missing ?? []).toEqual([]);
    }
  });

  type Report = {
    pluginReports: Array<{
      pluginName: string;
      violations?: Array<{ ruleName: string; severity?: string; violatingConstructs?: Array<{ constructPath: string }> }>;
    }>;
  };
  const reportPath = path.join(outdir, 'validation-report.json');
  const report: Report = fs.existsSync(reportPath) ? JSON.parse(fs.readFileSync(reportPath, 'utf8')) : { pluginReports: [] };
  const describe = (v: { ruleName: string; violatingConstructs?: Array<{ constructPath: string }> }) =>
    `${v.ruleName} @ ${(v.violatingConstructs ?? []).map((c) => c.constructPath).join(', ')}`;

  test('cdk-nag AwsSolutions: no unacknowledged findings', () => {
    const nag = report.pluginReports.filter((p) => p.pluginName === 'AwsSolutions').flatMap((p) => p.violations ?? []);
    expect(nag.map(describe)).toEqual([]);
  });

  test('CDK CloudFormation validation: no error-level findings', () => {
    // Warning W3010 (hard-coded AZs) is expected: explicit AZ names are what keep synth lookup-free.
    const errors = report.pluginReports
      .filter((p) => p.pluginName !== 'AwsSolutions')
      .flatMap((p) => p.violations ?? [])
      .filter((v) => v.severity === 'error' || v.severity === 'fatal');
    expect(errors.map(describe)).toEqual([]);
  });

  test('stack layout per environment', () => {
    const ids = assembly.nestedAssemblies.flatMap((a) => a.nestedAssembly.stacks.map((s) => s.hierarchicalId)).sort();
    expect(ids).toEqual(
      [
        'Qitah-production/Api',
        'Qitah-production/Auth',
        'Qitah-production/Data',
        'Qitah-production/Edge',
        'Qitah-production/GithubOidc',
        'Qitah-production/Hosting',
        'Qitah-production/Migrations',
        'Qitah-production/Monitoring',
        'Qitah-production/Network',
        'Qitah-production/Platform',
        'Qitah-staging/Api',
        'Qitah-staging/Auth',
        'Qitah-staging/Data',
        'Qitah-staging/GithubOidc',
        'Qitah-staging/Hosting',
        'Qitah-staging/Migrations',
        'Qitah-staging/Monitoring',
        'Qitah-staging/Network',
        'Qitah-staging/Platform',
      ].sort(),
    );
    const prodAccounts = new Set(assembly.nestedAssemblies.flatMap((a) => a.nestedAssembly.stacks.filter((s) => s.hierarchicalId.startsWith('Qitah-production')).map((s) => s.environment.account)));
    expect([...prodAccounts]).toEqual([ACCOUNTS.production]);
  });
});
