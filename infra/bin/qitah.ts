#!/usr/bin/env node
import { App, Validations } from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';

import { resolveAccount, resolveConfig, selectedEnvs } from '../config';
import { QitahStage } from '../lib/stage';

/**
 * Usage (no AWS credentials needed for synth):
 *   npx cdk synth -c stagingAccount=111111111111 -c productionAccount=222222222222
 *   npx cdk synth -c env=staging -c account=111111111111 -c imageTag=<git sha>
 *   npx cdk deploy 'Qitah-staging/*' -c env=staging -c imageTag=<git sha>
 */
const app = new App();
const ctx = (key: string) => app.node.tryGetContext(key);

const imageTag = ctx('imageTag') as string | undefined;
for (const envName of selectedEnvs(ctx)) {
  const config = resolveConfig(envName, ctx);
  new QitahStage(app, `Qitah-${envName}`, { config, account: resolveAccount(envName, ctx), imageTag });
}

if (ctx('nag') !== 'false' && ctx('nag') !== false) {
  // cdk-nag v3: AwsSolutions rule pack as a CDK policy-validation plugin. Any unacknowledged
  // finding fails synthesis; acknowledgements carry written reasons (see lib/nag.ts).
  Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
}

app.synth();
