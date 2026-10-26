import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { acknowledge, acknowledgeWildcardResources } from '../nag';
import { names } from '../names';

export interface GithubOidcStackProps extends StackProps {
  config: QitahConfig;
}

export const GITHUB_OIDC_HOST = 'token.actions.githubusercontent.com';

/**
 * GitHub Actions OIDC federation + a least-privilege deploy role for one environment.
 * Deployed once by an administrator (bootstrap step) and independent of every other stack:
 * all resource ARNs are built from the deterministic names in ../names.ts.
 *
 * The role can ONLY: assume the CDK bootstrap roles (which deploy through CloudFormation),
 * push/pull the API image, run the migration task, and update/describe the ECS services.
 * No AdministratorAccess, no IAM user, no long-lived keys.
 */
export class GithubOidcStack extends Stack {
  readonly deployRole: iam.Role;

  constructor(scope: Construct, id: string, props: GithubOidcStackProps) {
    super(scope, id, props);
    const { config } = props;
    const n = names(config.envName);
    const { account, region, partition } = this;

    const providerArn =
      config.github.existingOidcProviderArn ??
      new iam.CfnOIDCProvider(this, 'GithubOidcProvider', {
        url: `https://${GITHUB_OIDC_HOST}`,
        clientIdList: ['sts.amazonaws.com'],
      }).attrArn;

    const subjects = config.github.allowedSubjects.map((s) => `repo:${config.github.repository}:${s}`);
    this.deployRole = new iam.Role(this, 'DeployRole', {
      roleName: n.githubDeployRole,
      description: `GitHub Actions deploy role for Qitah ${config.envName} (${subjects.join(', ')})`,
      maxSessionDuration: Duration.hours(1),
      assumedBy: new iam.WebIdentityPrincipal(providerArn, {
        StringEquals: {
          [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
          [`${GITHUB_OIDC_HOST}:sub`]: subjects,
        },
      }),
    });

    const q = config.cdkQualifier;
    const repoArn = `arn:${partition}:ecr:${region}:${account}:repository/${n.ecrRepository}`;
    const clusterArn = `arn:${partition}:ecs:${region}:${account}:cluster/${n.cluster}`;

    const statements: iam.PolicyStatement[] = [
      new iam.PolicyStatement({
        sid: 'AssumeCdkBootstrapRoles',
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: ['deploy', 'file-publishing', 'image-publishing', 'lookup'].map(
          (r) => `arn:${partition}:iam::${account}:role/cdk-${q}-${r}-role-${account}-*`,
        ),
      }),
      new iam.PolicyStatement({ sid: 'EcrLogin', actions: ['ecr:GetAuthorizationToken'], resources: ['*'] }),
      new iam.PolicyStatement({
        sid: 'EcrPushApiImage',
        actions: [
          'ecr:BatchCheckLayerAvailability',
          'ecr:InitiateLayerUpload',
          'ecr:UploadLayerPart',
          'ecr:CompleteLayerUpload',
          'ecr:PutImage',
          'ecr:BatchGetImage',
          'ecr:GetDownloadUrlForLayer',
          'ecr:DescribeImages',
          'ecr:DescribeImageScanFindings',
        ],
        resources: [repoArn],
      }),
      new iam.PolicyStatement({
        sid: 'RunMigrationTask',
        actions: ['ecs:RunTask'],
        resources: [`arn:${partition}:ecs:${region}:${account}:task-definition/${n.migrationFamily}:*`],
        conditions: { ArnEquals: { 'ecs:cluster': clusterArn } },
      }),
      new iam.PolicyStatement({
        sid: 'TrackMigrationTask',
        actions: ['ecs:DescribeTasks', 'ecs:StopTask'],
        resources: [`arn:${partition}:ecs:${region}:${account}:task/${n.cluster}/*`],
      }),
      new iam.PolicyStatement({
        sid: 'PassMigrationRoles',
        actions: ['iam:PassRole'],
        resources: [n.migrationTaskRole, n.migrationExecutionRole].map((r) => `arn:${partition}:iam::${account}:role/${r}`),
        conditions: { StringEquals: { 'iam:PassedToService': 'ecs-tasks.amazonaws.com' } },
      }),
      new iam.PolicyStatement({
        sid: 'RollServices',
        actions: ['ecs:UpdateService', 'ecs:DescribeServices'],
        resources: [n.apiService, n.workerService].map((s) => `arn:${partition}:ecs:${region}:${account}:service/${n.cluster}/${s}`),
      }),
      new iam.PolicyStatement({
        sid: 'ReadMigrationLogs',
        actions: ['logs:GetLogEvents', 'logs:FilterLogEvents'],
        resources: [`arn:${partition}:logs:${region}:${account}:log-group:${n.migrationLogGroup}:*`],
      }),
      new iam.PolicyStatement({
        sid: 'ReadStackOutputs',
        actions: ['cloudformation:DescribeStacks'],
        resources: [`arn:${partition}:cloudformation:*:${account}:stack/${n.stagePrefix}-*/*`],
      }),
    ];
    if (config.compute.promoteFromRepositoryArn) {
      statements.push(
        new iam.PolicyStatement({
          sid: 'PullFromStagingForPromotion',
          actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability', 'ecr:DescribeImages'],
          resources: [config.compute.promoteFromRepositoryArn],
        }),
      );
    }
    const policy = new iam.Policy(this, 'DeployPolicy', { policyName: 'qitah-deploy', statements });
    policy.attachToRole(this.deployRole);

    new CfnOutput(this, 'DeployRoleArn', { value: this.deployRole.roleArn, description: 'Set as GitHub environment variable AWS_DEPLOY_ROLE_ARN' });
    new CfnOutput(this, 'OidcProviderArn', { value: providerArn });

    acknowledgeWildcardResources(
      policy,
      statements,
      'Bounded wildcards: CDK bootstrap role names end with the region; task-definition revisions, task ids and log streams ' +
        'are generated at runtime under fixed names; stack ARNs end with a generated id.',
    );
    acknowledge(policy, [{ id: 'AwsSolutions-IAM5[Resource::*]', reason: 'ecr:GetAuthorizationToken does not support resource-level permissions.' }]);
  }
}
