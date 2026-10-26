import { Annotations, CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import type * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { acknowledge } from '../nag';
import { appEnvironment, appSecrets, databaseSecrets, runtimePlatform } from '../app-container';
import { type DataRefs, importData } from '../imports';
import { API_PORT, names, ORIGIN_VERIFY_HEADER, UPLOAD_PREFIXES } from '../names';
import { retention, statefulRemoval } from '../util';

export interface ApiStackProps extends StackProps {
  config: QitahConfig;
  imageTag: string;
  vpc: ec2.IVpc;
  albSg: ec2.ISecurityGroup;
  apiSg: ec2.ISecurityGroup;
  workerSg: ec2.ISecurityGroup;
  cluster: ecs.ICluster;
  repository: ecr.IRepository;
  /** Data-stack ARNs; re-imported here so grants land in this stack's IAM policies. */
  dataRefs: DataRefs;
  logsBucket: s3.IBucket;
  customerPoolId: string;
  staffPoolId: string;
  clientIds: string[];
  /** WAF web ACL ARN (us-east-1) when edge.wafEnabled. */
  webAclArn?: string;
}

/** Regions whose S3 buckets cannot receive CloudFront standard logs (AWS documentation). */
const CLOUDFRONT_LOG_UNSUPPORTED = new Set([
  'af-south-1', 'ap-east-1', 'ap-south-2', 'ap-southeast-3', 'ap-southeast-4', 'ca-west-1', 'eu-south-1', 'eu-south-2',
  'eu-central-2', 'il-central-1', 'me-central-1', 'me-south-1',
]);

/**
 * Public edge (CloudFront -> ALB) and the two long-running ECS services (API, worker).
 * HTTPS today comes from the default *.cloudfront.net certificate; the ALB only accepts traffic
 * from CloudFront (managed prefix list on the SG) carrying the secret origin header.
 */
export class ApiStack extends Stack {
  readonly distribution: cloudfront.Distribution;
  readonly alb: elbv2.ApplicationLoadBalancer;
  readonly targetGroup: elbv2.ApplicationTargetGroup;
  readonly apiService: ecs.FargateService;
  readonly workerService: ecs.FargateService;
  readonly apiLogGroup: logs.LogGroup;
  readonly workerLogGroup: logs.LogGroup;
  readonly publicBaseUrl: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config } = props;
    const n = names(config.envName);
    const prod = config.envName === 'production';
    const originTls = config.edge.originTls;
    const data = importData(this, props.dataRefs);
    const uploadsBucket = data.uploadsBucket!;
    const jobsQueue = data.jobsQueue!;

    // ---------- secret origin header (CloudFront -> ALB) ----------
    const originVerify = new secretsmanager.Secret(this, 'OriginVerifySecret', {
      secretName: n.originVerifySecret,
      description: 'Shared secret header value CloudFront sends and the ALB requires',
      generateSecretString: { passwordLength: 48, excludePunctuation: true },
    });
    // CloudFormation dynamic reference: resolved at deploy time, not stored in the template.
    const originVerifyValue = originVerify.secretValue.unsafeUnwrap();

    // ---------- ALB ----------
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc: props.vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
      securityGroup: props.albSg,
      dropInvalidHeaderFields: true,
      idleTimeout: Duration.seconds(60),
      deletionProtection: prod,
    });
    this.alb.logAccessLogs(props.logsBucket, 'alb');

    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'ApiTargets', {
      vpc: props.vpc,
      port: API_PORT,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targetType: elbv2.TargetType.IP,
      deregistrationDelay: Duration.seconds(30),
      healthCheck: {
        path: '/ready',
        healthyHttpCodes: '200',
        interval: Duration.seconds(15),
        timeout: Duration.seconds(5),
        healthyThresholdCount: 2,
        unhealthyThresholdCount: 3,
      },
    });

    const listenerDefaults = {
      // Anything that does not carry the origin header (i.e. not from our distribution) gets 403.
      defaultAction: elbv2.ListenerAction.fixedResponse(403, { contentType: 'text/plain', messageBody: 'Forbidden' }),
    };
    const listeners: elbv2.ApplicationListener[] = [];
    if (originTls) {
      listeners.push(
        this.alb.addListener('Https', {
          port: 443,
          protocol: elbv2.ApplicationProtocol.HTTPS,
          certificates: [elbv2.ListenerCertificate.fromArn(originTls.certificateArn)],
          sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
          open: false,
          ...listenerDefaults,
        }),
      );
      this.alb.addListener('HttpRedirect', {
        port: 80,
        open: false,
        defaultAction: elbv2.ListenerAction.redirect({ protocol: 'HTTPS', port: '443', permanent: true }),
      });
    } else {
      listeners.push(this.alb.addListener('Http', { port: 80, protocol: elbv2.ApplicationProtocol.HTTP, open: false, ...listenerDefaults }));
    }
    for (const listener of listeners) {
      new elbv2.ApplicationListenerRule(this, `OriginVerifyRule${listener.node.id}`, {
        listener,
        priority: 10,
        conditions: [elbv2.ListenerCondition.httpHeader(ORIGIN_VERIFY_HEADER, [originVerifyValue])],
        action: elbv2.ListenerAction.forward([this.targetGroup]),
      });
    }

    // ---------- CloudFront ----------
    const customDomain = config.edge.customDomain;
    const logsSupported = !CLOUDFRONT_LOG_UNSUPPORTED.has(config.region);
    if (config.edge.accessLogs && !logsSupported) {
      Annotations.of(this).addWarningV2('qitah:cloudfront-logs', `CloudFront standard logs cannot be delivered to S3 in ${config.region}; disabled.`);
    }
    const originProps = {
      customHeaders: { [ORIGIN_VERIFY_HEADER]: originVerifyValue },
      readTimeout: Duration.seconds(30),
      keepaliveTimeout: Duration.seconds(5),
    };
    // With originTls, CloudFront connects over HTTPS to a DNS name (CNAME -> ALB) matching the certificate.
    const apiOrigin = originTls
      ? new origins.HttpOrigin(originTls.originDomainName, {
          ...originProps,
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
        })
      : new origins.LoadBalancerV2Origin(this.alb, { ...originProps, protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: `Qitah ${config.envName} API`,
      defaultBehavior: {
        origin: apiOrigin,
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        // API: never cache; forward every viewer header except Host (incl. Authorization) and all query strings.
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.SECURITY_HEADERS,
        compress: true,
      },
      priceClass: config.edge.priceClass as cloudfront.PriceClass,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      enableIpv6: true,
      webAclId: props.webAclArn,
      domainNames: customDomain ? [customDomain.domainName] : undefined,
      certificate: customDomain ? acm.Certificate.fromCertificateArn(this, 'CfCert', customDomain.cloudFrontCertificateArn) : undefined,
      enableLogging: config.edge.accessLogs && logsSupported,
      logBucket: config.edge.accessLogs && logsSupported ? props.logsBucket : undefined,
      logFilePrefix: 'cloudfront/',
    });
    if (customDomain?.hostedZone) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', customDomain.hostedZone);
      new route53.ARecord(this, 'ApiAlias', {
        zone,
        recordName: customDomain.domainName,
        target: route53.RecordTarget.fromAlias(new route53Targets.CloudFrontTarget(this.distribution)),
      });
    }
    this.publicBaseUrl = customDomain ? `https://${customDomain.domainName}` : `https://${this.distribution.distributionDomainName}`;

    // ---------- shared task configuration ----------
    const primaryPool = config.auth.apiPrimaryPool === 'customers' ? props.customerPoolId : props.staffPoolId;
    const environment = appEnvironment({
      config,
      publicBaseUrl: this.publicBaseUrl,
      cognitoUserPoolId: primaryPool,
      cognitoUserPoolIds: [props.customerPoolId, props.staffPoolId],
      cognitoClientIds: props.clientIds,
      jobsQueueUrl: jobsQueue.queueUrl,
      uploadsBucketName: uploadsBucket.bucketName,
    });
    const secrets = { ...databaseSecrets(data.dbSecret), ...appSecrets(data.appSecret!) };
    const image = ecs.ContainerImage.fromEcrRepository(props.repository, props.imageTag);

    this.apiLogGroup = new logs.LogGroup(this, 'ApiLogs', {
      logGroupName: n.apiLogGroup,
      retention: retention(config.compute.logRetentionDays),
      removalPolicy: statefulRemoval(config),
    });
    this.workerLogGroup = new logs.LogGroup(this, 'WorkerLogs', {
      logGroupName: n.workerLogGroup,
      retention: retention(config.compute.logRetentionDays),
      removalPolicy: statefulRemoval(config),
    });

    // ---------- API service ----------
    // Explicit least-privilege statements (instead of grant*() helpers, which add List*/GetBucket*/ReEncrypt*).
    const objectArns = UPLOAD_PREFIXES.map((p) => uploadsBucket.arnForObjects(`${p}*`));
    const uploadsStatements = [
      new iam.PolicyStatement({ sid: 'UploadsObjects', actions: ['s3:PutObject', 's3:GetObject'], resources: objectArns }),
      new iam.PolicyStatement({
        sid: 'UploadsKms',
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [data.key.keyArn],
        conditions: { StringEquals: { 'kms:ViaService': `s3.${this.region}.amazonaws.com` } },
      }),
    ];
    const queueStatements = (consume: boolean) => [
      new iam.PolicyStatement({
        sid: consume ? 'JobsSendReceive' : 'JobsSend',
        actions: [
          'sqs:SendMessage',
          'sqs:GetQueueAttributes',
          'sqs:GetQueueUrl',
          ...(consume ? ['sqs:ReceiveMessage', 'sqs:DeleteMessage', 'sqs:ChangeMessageVisibility'] : []),
        ],
        resources: [jobsQueue.queueArn],
      }),
      new iam.PolicyStatement({
        sid: 'JobsKms',
        actions: ['kms:GenerateDataKey', 'kms:Decrypt'],
        resources: [data.key.keyArn],
        conditions: { StringEquals: { 'kms:ViaService': `sqs.${this.region}.amazonaws.com` } },
      }),
    ];

    const apiTaskRole = new iam.Role(this, 'ApiTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Qitah API: presigned S3 PUT/GET under allowed prefixes, enqueue jobs',
    });
    for (const st of [...uploadsStatements, ...queueStatements(false)]) apiTaskRole.addToPolicy(st);

    const apiTask = new ecs.FargateTaskDefinition(this, 'ApiTask', {
      family: `qitah-${config.envName}-api`,
      cpu: config.compute.api.cpu,
      memoryLimitMiB: config.compute.api.memoryMiB,
      runtimePlatform: runtimePlatform(config),
      taskRole: apiTaskRole,
    });
    apiTask.addVolume({ name: 'tmp' });
    const apiContainer = apiTask.addContainer('api', {
      containerName: 'api',
      image,
      command: ['node', 'dist/main.js'],
      essential: true,
      environment,
      secrets,
      portMappings: [{ containerPort: API_PORT, protocol: ecs.Protocol.TCP }],
      readonlyRootFilesystem: true,
      linuxParameters: new ecs.LinuxParameters(this, 'ApiLinux', { initProcessEnabled: true }),
      logging: ecs.LogDrivers.awsLogs({ logGroup: this.apiLogGroup, streamPrefix: 'api' }),
      healthCheck: {
        command: ['CMD-SHELL', `node -e "fetch('http://127.0.0.1:${API_PORT}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"`],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
      stopTimeout: Duration.seconds(30),
    });
    apiContainer.addMountPoints({ containerPath: '/tmp', sourceVolume: 'tmp', readOnly: false });

    this.apiService = new ecs.FargateService(this, 'ApiService', {
      serviceName: n.apiService,
      cluster: props.cluster,
      taskDefinition: apiTask,
      // No desiredCount: autoscaling (min = compute.api.minTasks) owns it, so deploys never reset a scale-out.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.apiSg],
      assignPublicIp: false,
      healthCheckGracePeriod: Duration.seconds(60),
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      enableECSManagedTags: true,
    });
    this.apiService.attachToApplicationTargetGroup(this.targetGroup);

    const scaling = this.apiService.autoScaleTaskCount({ minCapacity: config.compute.api.minTasks, maxCapacity: config.compute.api.maxTasks });
    scaling.scaleOnCpuUtilization('Cpu', {
      targetUtilizationPercent: config.compute.api.targetCpuPercent,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(1),
    });
    scaling.scaleOnRequestCount('Requests', {
      requestsPerTarget: config.compute.api.requestsPerTarget,
      targetGroup: this.targetGroup,
      scaleInCooldown: Duration.minutes(5),
      scaleOutCooldown: Duration.minutes(1),
    });

    // ---------- worker service ----------
    const workerTaskRole = new iam.Role(this, 'WorkerTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'Qitah worker: send/receive on the jobs queue, read/write documents under allowed prefixes',
    });
    for (const st of [...uploadsStatements, ...queueStatements(true)]) workerTaskRole.addToPolicy(st);

    const workerTask = new ecs.FargateTaskDefinition(this, 'WorkerTask', {
      family: `qitah-${config.envName}-worker`,
      cpu: config.compute.worker.cpu,
      memoryLimitMiB: config.compute.worker.memoryMiB,
      runtimePlatform: runtimePlatform(config),
      taskRole: workerTaskRole,
    });
    workerTask.addVolume({ name: 'tmp' });
    const workerContainer = workerTask.addContainer('worker', {
      containerName: 'worker',
      image,
      command: ['node', 'dist/worker.js'],
      essential: true,
      environment,
      secrets,
      readonlyRootFilesystem: true,
      linuxParameters: new ecs.LinuxParameters(this, 'WorkerLinux', { initProcessEnabled: true }),
      logging: ecs.LogDrivers.awsLogs({ logGroup: this.workerLogGroup, streamPrefix: 'worker' }),
      stopTimeout: Duration.seconds(30),
    });
    workerContainer.addMountPoints({ containerPath: '/tmp', sourceVolume: 'tmp', readOnly: false });

    this.workerService = new ecs.FargateService(this, 'WorkerService', {
      serviceName: n.workerService,
      cluster: props.cluster,
      taskDefinition: workerTask,
      desiredCount: config.compute.worker.desiredTasks,
      // Jobs are idempotent and use FOR UPDATE SKIP LOCKED (services/api/src/jobs.ts), so old and new
      // workers may overlap during a rolling deploy; this keeps the worker running throughout.
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      circuitBreaker: { enable: true, rollback: true },
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [props.workerSg],
      assignPublicIp: false,
      propagateTags: ecs.PropagatedTagSource.SERVICE,
      enableECSManagedTags: true,
    });

    new CfnOutput(this, 'ApiBaseUrl', { value: this.publicBaseUrl });
    new CfnOutput(this, 'DistributionDomainName', { value: this.distribution.distributionDomainName });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId });
    new CfnOutput(this, 'AlbDnsName', { value: this.alb.loadBalancerDnsName });
    new CfnOutput(this, 'ClusterName', { value: props.cluster.clusterName });
    new CfnOutput(this, 'ApiServiceName', { value: this.apiService.serviceName });
    new CfnOutput(this, 'WorkerServiceName', { value: this.workerService.serviceName });

    // ---------- cdk-nag suppressions ----------
    acknowledge(originVerify, [
      { id: 'AwsSolutions-SMG4', reason: 'Origin header secret is rotated manually (update secret, redeploy Api stack); see DEPLOYMENT.md.' },
    ]);
    for (const td of [apiTask, workerTask]) {
      acknowledge(td, [
        {
          id: 'AwsSolutions-ECS2',
          reason: 'Only non-secret configuration is plain environment; DB credentials and webhook secrets use ECS secrets from Secrets Manager.',
        },
      ]);
    }
    acknowledge([apiTask, workerTask], [
      {
        id: 'AwsSolutions-IAM5[Resource::*]',
        reason: 'Task execution role: ecr:GetAuthorizationToken does not support resource-level permissions.',
      },
    ]);
    acknowledge([apiTaskRole, workerTaskRole], objectArns.map((arn) => ({
      id: `AwsSolutions-IAM5[Resource::${arn}]`,
      reason: 'Object-level access is limited to the documented upload prefixes (merchants/, shipping-labels/) of one bucket.',
    })));
    acknowledge(this.distribution, [
      ...(customDomain
        ? []
        : [
            {
              id: 'AwsSolutions-CFR4',
              reason: 'No custom domain yet: the default *.cloudfront.net certificate is used (TLS policy cannot be pinned). Set edge.customDomain.',
            },
          ]),
      ...(originTls ? [] : [{ id: 'AwsSolutions-CFR5', reason: 'Origin hop is HTTP until edge.originTls is configured (needs a domain + regional ACM cert).' }]),
      ...(props.webAclArn ? [] : [{ id: 'AwsSolutions-CFR2', reason: 'WAF is a cost toggle (edge.wafEnabled); enabled in production.' }]),
      { id: 'AwsSolutions-CFR1', reason: 'Saudi marketplace API; geo restriction would block legitimate roaming users. WAF handles abuse.' },
      ...(config.edge.accessLogs && logsSupported ? [] : [{ id: 'AwsSolutions-CFR3', reason: 'CloudFront access logs disabled by config or region.' }]),
    ]);
  }
}
