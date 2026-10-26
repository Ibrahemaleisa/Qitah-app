import { CfnOutput, SecretValue, Stack, type StackProps } from 'aws-cdk-lib';
import * as amplify from 'aws-cdk-lib/aws-amplify';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { acknowledgeWildcardResources } from '../nag';

export interface HostingStackProps extends StackProps {
  config: QitahConfig;
  apiBaseUrl: string;
  merchantPortalClientId: string;
  opsPortalClientId: string;
}

/** Monorepo build spec for a Next.js SSR app under `portals/<name>` (Amplify WEB_COMPUTE). */
export function portalBuildSpec(appRoot: string): string {
  // Amplify does not expose branch env vars to the SSR runtime; the documented pattern is to write
  // the server-only ones to .env.production at build time (never NEXT_PUBLIC_*, so not in the bundle).
  return [
    'version: 1',
    'applications:',
    `  - appRoot: ${appRoot}`,
    '    frontend:',
    '      phases:',
    '        preBuild:',
    '          commands:',
    '            - nvm use 22 || true',
    '            - npm ci',
    '        build:',
    '          commands:',
    "            - env | grep -E '^(API_BASE_URL|AUTH_MODE|COGNITO_REGION|COGNITO_CLIENT_ID)=' > .env.production",
    '            - npm run build',
    '      artifacts:',
    '        baseDirectory: .next',
    '        files:',
    "          - '**/*'",
    '      cache:',
    '        paths:',
    "          - 'node_modules/**/*'",
    "          - '.next/cache/**/*'",
    '',
  ].join('\n');
}

/**
 * Amplify Hosting apps for portals/merchant and portals/ops. Separate stack: it needs a GitHub
 * token (external blocker) and Amplify Hosting may not exist in every region.
 */
export class HostingStack extends Stack {
  constructor(scope: Construct, id: string, props: HostingStackProps) {
    super(scope, id, props);
    const { config } = props;
    const h = config.hosting;
    const prefix = `qitah-${config.envName}`;

    const serviceRole = new iam.Role(this, 'AmplifyServiceRole', {
      assumedBy: new iam.ServicePrincipal('amplify.amazonaws.com'),
      description: 'Amplify Hosting: write SSR compute and build logs',
    });
    const logsStatement = new iam.PolicyStatement({
      actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogGroups'],
      resources: [`arn:${this.partition}:logs:${this.region}:${this.account}:log-group:/aws/amplify/*`],
    });
    serviceRole.addToPolicy(logsStatement);
    acknowledgeWildcardResources(serviceRole, [logsStatement], 'Amplify creates log groups under /aws/amplify/<appId> at runtime; scoped to that prefix.');

    const accessToken = SecretValue.secretsManager(h.githubTokenSecretName).unsafeUnwrap();
    const basicAuth = h.basicAuthSecretName
      ? {
          enableBasicAuth: true,
          username: SecretValue.secretsManager(h.basicAuthSecretName, { jsonField: 'username' }).unsafeUnwrap(),
          password: SecretValue.secretsManager(h.basicAuthSecretName, { jsonField: 'password' }).unsafeUnwrap(),
        }
      : undefined;

    const portals = [
      { key: 'merchant', appRoot: 'portals/merchant', clientId: props.merchantPortalClientId },
      { key: 'ops', appRoot: 'portals/ops', clientId: props.opsPortalClientId },
    ];
    for (const p of portals) {
      const env = {
        AMPLIFY_MONOREPO_APP_ROOT: p.appRoot,
        API_BASE_URL: props.apiBaseUrl,
        AUTH_MODE: 'cognito',
        COGNITO_REGION: config.region,
        COGNITO_CLIENT_ID: p.clientId,
      };
      const app = new amplify.CfnApp(this, `${p.key}App`, {
        name: `${prefix}-${p.key}-portal`,
        description: `Qitah ${p.key} portal (${config.envName})`,
        repository: h.repositoryUrl,
        accessToken,
        platform: 'WEB_COMPUTE',
        iamServiceRole: serviceRole.roleArn,
        buildSpec: portalBuildSpec(p.appRoot),
        environmentVariables: Object.entries(env).map(([name, value]) => ({ name, value })),
        enableBranchAutoDeletion: false,
        basicAuthConfig: basicAuth,
      });
      const branch = new amplify.CfnBranch(this, `${p.key}Branch`, {
        appId: app.attrAppId,
        branchName: h.branch,
        stage: config.envName === 'production' ? 'PRODUCTION' : 'BETA',
        framework: 'Next.js - SSR',
        enableAutoBuild: true,
        enablePullRequestPreview: false,
        basicAuthConfig: basicAuth,
        environmentVariables: [{ name: 'AMPLIFY_MONOREPO_APP_ROOT', value: p.appRoot }],
      });
      new CfnOutput(this, `${p.key}PortalUrl`, { value: `https://${branch.branchName}.${app.attrDefaultDomain}` });
      new CfnOutput(this, `${p.key}AppId`, { value: app.attrAppId });
    }
  }
}
