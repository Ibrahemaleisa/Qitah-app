import { Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cr from 'aws-cdk-lib/custom-resources';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { acknowledge } from '../nag';
import { API_PORT } from '../names';
import { retention, statefulRemoval } from '../util';

export interface NetworkStackProps extends StackProps {
  config: QitahConfig;
}

/**
 * VPC (public / private-with-egress / isolated across 2 AZs), endpoints, flow logs and ALL
 * application security groups. Keeping every security group here avoids cross-stack cycles.
 */
export class NetworkStack extends Stack {
  readonly vpc: ec2.Vpc;
  readonly albSg: ec2.SecurityGroup;
  readonly apiSg: ec2.SecurityGroup;
  readonly workerSg: ec2.SecurityGroup;
  readonly migrationSg: ec2.SecurityGroup;
  readonly dbSg: ec2.SecurityGroup;
  private readonly azNames: string[];

  /**
   * Explicit AZ names: overriding this getter stops CDK from registering an `availability-zones`
   * context lookup, so `cdk synth` needs no AWS credentials (and never uses dummy AZs).
   */
  override get availabilityZones(): string[] {
    return this.azNames;
  }

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
    const { config } = props;
    const n = config.network;

    const azs = n.availabilityZones ?? ['a', 'b', 'c'].slice(0, n.maxAzs).map((s) => `${config.region}${s}`);
    this.azNames = azs;

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      ipAddresses: ec2.IpAddresses.cidr(n.cidr),
      availabilityZones: azs,
      natGateways: n.natGateways,
      restrictDefaultSecurityGroup: true,
      subnetConfiguration: [
        { name: 'public', subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: 'app', subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 22 },
        { name: 'data', subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });

    const flowLogGroup = new logs.LogGroup(this, 'FlowLogs', {
      retention: retention(n.flowLogRetentionDays),
      removalPolicy: statefulRemoval(config),
    });
    this.vpc.addFlowLog('FlowLog', {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(flowLogGroup),
      trafficType: ec2.FlowLogTrafficType.ALL,
    });

    // Gateway endpoint for S3 is free and carries ECR image layers and document traffic.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
      subnets: [{ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }, { subnetType: ec2.SubnetType.PRIVATE_ISOLATED }],
    });

    if (n.interfaceEndpoints) {
      const endpointSg = new ec2.SecurityGroup(this, 'EndpointSg', {
        vpc: this.vpc,
        description: 'Interface VPC endpoints (HTTPS from inside the VPC)',
        allowAllOutbound: false,
      });
      endpointSg.addIngressRule(ec2.Peer.ipv4(this.vpc.vpcCidrBlock), ec2.Port.tcp(443), 'HTTPS from VPC');
      acknowledge(endpointSg, [{ id: 'AwsSolutions-EC23', reason: 'Ingress is the VPC CIDR only (unresolved token at synth), not 0.0.0.0/0.' }]);
      const services: Record<string, ec2.InterfaceVpcEndpointAwsService> = {
        EcrApi: ec2.InterfaceVpcEndpointAwsService.ECR,
        EcrDocker: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER,
        SecretsManager: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER,
        Logs: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS,
        Sqs: ec2.InterfaceVpcEndpointAwsService.SQS,
      };
      for (const [name, service] of Object.entries(services)) {
        this.vpc.addInterfaceEndpoint(`${name}Endpoint`, {
          service,
          privateDnsEnabled: true,
          securityGroups: [endpointSg],
          subnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        });
      }
    }

    // ---------- security groups ----------
    this.albSg = new ec2.SecurityGroup(this, 'AlbSg', {
      vpc: this.vpc,
      description: 'Public ALB - only reachable from CloudFront origin-facing IPs',
      allowAllOutbound: false,
    });
    this.apiSg = new ec2.SecurityGroup(this, 'ApiSg', { vpc: this.vpc, description: 'API Fargate tasks', allowAllOutbound: true });
    this.workerSg = new ec2.SecurityGroup(this, 'WorkerSg', { vpc: this.vpc, description: 'Worker Fargate tasks (no ingress)', allowAllOutbound: true });
    this.migrationSg = new ec2.SecurityGroup(this, 'MigrationSg', {
      vpc: this.vpc,
      description: 'One-off Prisma migration task (no ingress)',
      allowAllOutbound: true,
    });
    this.dbSg = new ec2.SecurityGroup(this, 'DbSg', {
      vpc: this.vpc,
      description: 'RDS PostgreSQL - only from ECS services',
      allowAllOutbound: false,
    });

    // AWS-managed CloudFront origin-facing prefix list, resolved at DEPLOY time (no synth-time lookup).
    // It counts as ~55 rules against the security-group rule quota, so keep this SG to this rule only.
    const prefixListLookup = new cr.AwsCustomResource(this, 'CloudFrontPrefixListLookup', {
      onUpdate: {
        service: 'EC2',
        action: 'describeManagedPrefixLists',
        parameters: { Filters: [{ Name: 'prefix-list-name', Values: ['com.amazonaws.global.cloudfront.origin-facing'] }] },
        physicalResourceId: cr.PhysicalResourceId.of(`cloudfront-origin-facing-${config.region}`),
        outputPaths: ['PrefixLists.0.PrefixListId'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({ resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE }),
      installLatestAwsSdk: false,
    });
    const cloudFrontPrefixListId = prefixListLookup.getResponseField('PrefixLists.0.PrefixListId');
    const originPorts = config.edge.originTls ? [80, 443] : [80];
    for (const port of originPorts) {
      this.albSg.addIngressRule(ec2.Peer.prefixList(cloudFrontPrefixListId), ec2.Port.tcp(port), `CloudFront origin-facing :${port}`);
    }
    this.albSg.addEgressRule(this.apiSg, ec2.Port.tcp(API_PORT), 'ALB to API tasks');
    this.apiSg.addIngressRule(this.albSg, ec2.Port.tcp(API_PORT), 'From ALB only');

    for (const [sg, label] of [
      [this.apiSg, 'API'],
      [this.workerSg, 'worker'],
      [this.migrationSg, 'migration'],
    ] as const) {
      this.dbSg.addIngressRule(sg, ec2.Port.tcp(5432), `PostgreSQL from ${label}`);
    }

    acknowledge(prefixListLookup, [
      { id: 'AwsSolutions-IAM5[Resource::*]', reason: 'ec2:DescribeManagedPrefixLists does not support resource-level permissions; read-only lookup.' },
    ]);
    // CDK-managed singleton custom-resource Lambdas live at stack level.
    acknowledge(this, [
      {
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]',
        reason: 'CDK-managed custom-resource Lambdas (prefix-list lookup, default-SG restriction) only need basic CloudWatch Logs access.',
      },
    ]);
  }
}
