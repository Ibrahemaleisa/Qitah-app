import { CfnOutput, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { acknowledge } from '../nag';
import { databaseEnvironment, databaseSecrets, runtimePlatform } from '../app-container';
import { type DataRefs, importData } from '../imports';
import { names } from '../names';
import { retention, statefulRemoval } from '../util';

export interface MigrationsStackProps extends StackProps {
  config: QitahConfig;
  imageTag: string;
  vpc: ec2.IVpc;
  migrationSg: ec2.ISecurityGroup;
  cluster: ecs.ICluster;
  repository: ecr.IRepository;
  dataRefs: DataRefs;
}

/**
 * Task definition for `npx prisma migrate deploy`, run by CI as a one-off task BEFORE the services
 * roll to the same image (expand/contract migrations). Separate stack so CI can update it first.
 */
export class MigrationsStack extends Stack {
  readonly taskDefinition: ecs.FargateTaskDefinition;

  constructor(scope: Construct, id: string, props: MigrationsStackProps) {
    super(scope, id, props);
    const { config } = props;
    const n = names(config.envName);

    const executionRole = new iam.Role(this, 'ExecutionRole', {
      roleName: n.migrationExecutionRole,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Pulls the API image, writes logs and reads the DB secret for the migration task',
    });
    const taskRole = new iam.Role(this, 'TaskRole', {
      roleName: n.migrationTaskRole,
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Migration task role (no AWS API permissions needed)',
    });

    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      logGroupName: n.migrationLogGroup,
      retention: retention(config.compute.logRetentionDays),
      removalPolicy: statefulRemoval(config),
    });

    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      family: n.migrationFamily,
      cpu: config.compute.migration.cpu,
      memoryLimitMiB: config.compute.migration.memoryMiB,
      runtimePlatform: runtimePlatform(config),
      executionRole,
      taskRole,
    });
    this.taskDefinition.addContainer('migrate', {
      containerName: 'migrate',
      image: ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag),
      command: ['npx', 'prisma', 'migrate', 'deploy'],
      essential: true,
      environment: { ...databaseEnvironment(config), NODE_ENV: config.app.nodeEnv, NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
      secrets: databaseSecrets(importData(this, props.dataRefs).dbSecret),
      logging: ecs.LogDrivers.awsLogs({ logGroup, streamPrefix: 'migrate' }),
      linuxParameters: new ecs.LinuxParameters(this, 'LinuxParams', { initProcessEnabled: true }),
    });

    const privateSubnets = props.vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }).subnetIds;
    // Consumed by CI (`cdk deploy --outputs-file`) to call `aws ecs run-task`.
    new CfnOutput(this, 'MigrationTaskDefinitionArn', { value: this.taskDefinition.taskDefinitionArn });
    new CfnOutput(this, 'ClusterName', { value: props.cluster.clusterName });
    new CfnOutput(this, 'MigrationSubnets', { value: privateSubnets.join(',') });
    new CfnOutput(this, 'MigrationSecurityGroup', { value: props.migrationSg.securityGroupId });
    new CfnOutput(this, 'MigrationLogGroup', { value: logGroup.logGroupName });

    acknowledge(executionRole, [
      { id: 'AwsSolutions-IAM5[Resource::*]', reason: 'ecr:GetAuthorizationToken does not support resource-level permissions.' },
    ]);
    acknowledge(this.taskDefinition, [
      { id: 'AwsSolutions-ECS2', reason: 'Only non-secret settings (DB name, SSL mode, NODE_ENV) are plain environment; credentials use ECS secrets.' },
    ]);
  }
}
