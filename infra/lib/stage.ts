import { Annotations, Stage, Tags, type StageProps } from 'aws-cdk-lib';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../config';
import { IMAGE_TAG_PLACEHOLDER } from './app-container';
import { bucketNames, names } from './names';
import { ApiStack } from './stacks/api-stack';
import { AuthStack } from './stacks/auth-stack';
import { DataStack } from './stacks/data-stack';
import { EdgeStack } from './stacks/edge-stack';
import { GithubOidcStack } from './stacks/github-oidc-stack';
import { HostingStack } from './stacks/hosting-stack';
import { MigrationsStack } from './stacks/migrations-stack';
import { MonitoringStack } from './stacks/monitoring-stack';
import { NetworkStack } from './stacks/network-stack';
import { PlatformStack } from './stacks/platform-stack';

export interface QitahStageProps extends StageProps {
  config: QitahConfig;
  account: string;
  imageTag?: string;
}

/**
 * One deployable environment. Stack ids (CLI paths): Qitah-<env>/<Stack>, e.g. `Qitah-staging/Api`.
 *
 *   GithubOidc  (independent, deploy first, by an admin)
 *   Network -> Data -> Migrations -> Api -> Monitoring
 *   Auth ------------------------->  Api -> Hosting
 *   Platform (ECR + cluster) ----> Migrations / Api
 *   Edge (us-east-1, WAF) -------->  Api
 */
export class QitahStage extends Stage {
  readonly stacks: {
    network: NetworkStack;
    data: DataStack;
    auth: AuthStack;
    platform: PlatformStack;
    migrations: MigrationsStack;
    api: ApiStack;
    monitoring: MonitoringStack;
    github: GithubOidcStack;
    edge?: EdgeStack;
    hosting?: HostingStack;
  };

  constructor(scope: Construct, id: string, props: QitahStageProps) {
    super(scope, id, { ...props, env: { account: props.account, region: props.config.region } });
    const { config } = props;
    const env = { account: props.account, region: config.region };
    const n = names(config.envName);
    const imageTag = props.imageTag ?? IMAGE_TAG_PLACEHOLDER;
    const sp = (description: string) => ({ env, description: `Qitah ${config.envName}: ${description}`, terminationProtection: config.envName === 'production' });

    const github = new GithubOidcStack(this, 'GithubOidc', { ...sp('GitHub Actions OIDC deploy role'), stackName: `${n.stagePrefix}-GithubOidc`, config });
    const network = new NetworkStack(this, 'Network', { ...sp('VPC, endpoints, security groups'), stackName: `${n.stagePrefix}-Network`, config });
    const data = new DataStack(this, 'Data', {
      ...sp('RDS, S3, SQS, KMS, secrets, backup'),
      stackName: `${n.stagePrefix}-Data`,
      config,
      vpc: network.vpc,
      dbSg: network.dbSg,
    });
    const auth = new AuthStack(this, 'Auth', { ...sp('Cognito user pools'), stackName: `${n.stagePrefix}-Auth`, config });
    const platform = new PlatformStack(this, 'Platform', { ...sp('ECR repository and ECS cluster'), stackName: `${n.stagePrefix}-Platform`, config, vpc: network.vpc });
    const migrations = new MigrationsStack(this, 'Migrations', {
      ...sp('Prisma migration task definition'),
      stackName: `${n.stagePrefix}-Migrations`,
      config,
      imageTag,
      vpc: network.vpc,
      migrationSg: network.migrationSg,
      cluster: platform.cluster,
      repository: platform.repository,
      dataRefs: { dataKeyArn: data.dataKey.keyArn, dbSecretArn: data.dbSecret.secretArn },
    });

    let edge: EdgeStack | undefined;
    const needsEdge = config.edge.wafEnabled || (config.hosting.ipAllowList?.length ?? 0) > 0;
    if (needsEdge) {
      edge = new EdgeStack(this, 'Edge', {
        ...sp('WAF web ACLs for CloudFront (us-east-1)'),
        stackName: `${n.stagePrefix}-Edge`,
        env: { account: props.account, region: 'us-east-1' },
        crossRegionReferences: config.region !== 'us-east-1',
        config,
      });
    }

    const api = new ApiStack(this, 'Api', {
      ...sp('CloudFront, ALB, ECS API and worker services'),
      stackName: `${n.stagePrefix}-Api`,
      crossRegionReferences: !!edge && config.region !== 'us-east-1',
      config,
      imageTag,
      vpc: network.vpc,
      albSg: network.albSg,
      apiSg: network.apiSg,
      workerSg: network.workerSg,
      cluster: platform.cluster,
      repository: platform.repository,
      dataRefs: {
        dataKeyArn: data.dataKey.keyArn,
        dbSecretArn: data.dbSecret.secretArn,
        appSecretArn: data.appSecret.secretArn,
        // Deterministic names (not tokens) keep IAM resources literal and reviewable.
        uploadsBucketName: bucketNames(config.envName, props.account, config.region).uploads,
        jobsQueueName: n.jobsQueue,
      },
      logsBucket: data.logsBucket,
      customerPoolId: auth.customerPool.userPoolId,
      staffPoolId: auth.staffPool.userPoolId,
      clientIds: [auth.mobileClient.userPoolClientId, auth.merchantPortalClient.userPoolClientId, auth.opsPortalClient.userPoolClientId],
      webAclArn: edge?.apiWebAclArn,
    });
    // Names are deterministic, so declare the ordering explicitly.
    api.addStackDependency(data, 'Uses the uploads bucket, queue and secrets');
    // Migrations must exist (and run in CI) before services roll to a new image.
    api.addStackDependency(migrations, 'CI runs migrations before rolling the services');

    const monitoring = new MonitoringStack(this, 'Monitoring', {
      ...sp('Alarms, dashboard, budgets'),
      stackName: `${n.stagePrefix}-Monitoring`,
      config,
      alb: api.alb,
      targetGroup: api.targetGroup,
      apiService: api.apiService,
      workerService: api.workerService,
      clusterName: n.cluster,
      apiLogGroup: api.apiLogGroup,
      workerLogGroup: api.workerLogGroup,
      db: data.db,
      jobsQueue: data.jobsQueue,
      jobsDlq: data.jobsDlq,
    });

    let hosting: HostingStack | undefined;
    if (config.hosting.enabled) {
      hosting = new HostingStack(this, 'Hosting', {
        ...sp('Amplify Hosting for merchant and ops portals'),
        stackName: `${n.stagePrefix}-Hosting`,
        config,
        apiBaseUrl: api.publicBaseUrl,
        merchantPortalClientId: auth.merchantPortalClient.userPoolClientId,
        opsPortalClientId: auth.opsPortalClient.userPoolClientId,
      });
    }

    this.stacks = { network, data, auth, platform, migrations, api, monitoring, github, edge, hosting };

    // ---------- tagging (cost allocation + ownership) ----------
    Tags.of(this).add('Project', 'Qitah');
    Tags.of(this).add('Environment', config.envName);
    Tags.of(this).add('Owner', config.tags.owner);
    Tags.of(this).add('CostCenter', config.tags.costCenter);
    Tags.of(this).add('ManagedBy', 'cdk');
    // Personal data (customers, merchants, orders, KYC documents) lives in Data and Auth.
    for (const s of [data, auth]) Tags.of(s).add('DataClassification', 'Confidential');
    for (const s of [network, platform, migrations, api, monitoring, github, ...(edge ? [edge] : []), ...(hosting ? [hosting] : [])]) {
      Tags.of(s).add('DataClassification', 'Internal');
    }

    if (imageTag === IMAGE_TAG_PLACEHOLDER) {
      for (const s of [migrations, api]) {
        Annotations.of(s).addWarningV2('qitah:image-tag', `No -c imageTag=<git sha> given; using "${IMAGE_TAG_PLACEHOLDER}". Do not deploy this synth.`);
      }
    }
  }
}
