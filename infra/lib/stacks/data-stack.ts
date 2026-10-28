import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as backup from 'aws-cdk-lib/aws-backup';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as events from 'aws-cdk-lib/aws-events';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { acknowledge } from '../nag';
import { bucketNames, names } from '../names';
import { statefulRemoval } from '../util';

export interface DataStackProps extends StackProps {
  config: QitahConfig;
  vpc: ec2.IVpc;
  dbSg: ec2.ISecurityGroup;
}

/**
 * Stateful resources holding personal data: KMS key, RDS PostgreSQL, documents bucket (+ logs
 * bucket), SQS jobs queue + DLQ, the application secret and the AWS Backup plan.
 */
export class DataStack extends Stack {
  readonly dataKey: kms.Key;
  readonly db: rds.DatabaseInstance;
  readonly dbSecret: secretsmanager.ISecret;
  readonly appSecret: secretsmanager.Secret;
  readonly uploadsBucket: s3.Bucket;
  readonly logsBucket: s3.Bucket;
  readonly jobsQueue: sqs.Queue;
  readonly jobsDlq: sqs.Queue;

  constructor(scope: Construct, id: string, props: DataStackProps) {
    super(scope, id, props);
    const { config, vpc, dbSg } = props;
    const n = names(config.envName);
    const prod = config.envName === 'production';
    const removal = statefulRemoval(config);
    const buckets = bucketNames(config.envName, this.account, this.region);

    this.dataKey = new kms.Key(this, 'DataKey', {
      alias: `alias/qitah-${config.envName}-data`,
      description: `Qitah ${config.envName} data encryption (RDS, S3, SQS, Secrets, Backup)`,
      enableKeyRotation: true,
      removalPolicy: removal,
    });

    // ---------- logs bucket (S3 server access logs, ALB and CloudFront logs: SSE-S3 is required) ----------
    this.logsBucket = new s3.Bucket(this, 'LogsBucket', {
      bucketName: buckets.logs,
      encryption: s3.BucketEncryption.S3_MANAGED,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      // CloudFront standard logs still need ACLs.
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_PREFERRED,
      lifecycleRules: [
        { id: 'expire-logs', expiration: Duration.days(config.storage.accessLogRetentionDays), abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      removalPolicy: removal,
      autoDeleteObjects: !prod,
    });

    // ---------- uploads bucket: merchant verification documents + shipping labels ----------
    this.uploadsBucket = new s3.Bucket(this, 'UploadsBucket', {
      bucketName: buckets.uploads,
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.dataKey,
      bucketKeyEnabled: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      enforceSSL: true,
      minimumTLSVersion: 1.2,
      versioned: true,
      serverAccessLogsBucket: this.logsBucket,
      serverAccessLogsPrefix: 's3/uploads/',
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET, s3.HttpMethods.HEAD],
          allowedOrigins: config.storage.uploadCorsOrigins,
          allowedHeaders: ['content-type', 'content-length', 'x-amz-*'],
          exposedHeaders: ['ETag'],
          maxAge: 3000,
        },
      ],
      lifecycleRules: [
        { id: 'abort-mpu', abortIncompleteMultipartUploadAfter: Duration.days(7) },
        { id: 'noncurrent', noncurrentVersionExpiration: Duration.days(config.storage.noncurrentVersionExpirationDays) },
        {
          id: 'labels-to-ia',
          prefix: 'shipping-labels/',
          transitions: [
            { storageClass: s3.StorageClass.INFREQUENT_ACCESS, transitionAfter: Duration.days(config.storage.labelsTransitionDays) },
            { storageClass: s3.StorageClass.GLACIER_INSTANT_RETRIEVAL, transitionAfter: Duration.days(Math.max(90, config.storage.labelsTransitionDays + 30)) },
          ],
        },
      ],
      removalPolicy: removal,
      autoDeleteObjects: !prod,
    });

    // ---------- queues ----------
    this.jobsDlq = new sqs.Queue(this, 'JobsDlq', {
      queueName: n.jobsDlq,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.dataKey,
      dataKeyReuse: Duration.hours(1),
      retentionPeriod: Duration.days(14),
      enforceSSL: true,
    });
    this.jobsQueue = new sqs.Queue(this, 'JobsQueue', {
      queueName: n.jobsQueue,
      encryption: sqs.QueueEncryption.KMS,
      encryptionMasterKey: this.dataKey,
      dataKeyReuse: Duration.hours(1),
      visibilityTimeout: Duration.seconds(config.queue.visibilityTimeoutSeconds),
      retentionPeriod: Duration.days(config.queue.retentionDays),
      deadLetterQueue: { queue: this.jobsDlq, maxReceiveCount: config.queue.maxReceiveCount },
      enforceSSL: true,
    });

    // ---------- application secret (webhook secrets) ----------
    // PAYMENT_WEBHOOK_SECRET is generated. CARRIER_WEBHOOK_SECRET starts EMPTY on purpose: the API
    // refuses to boot (min length 16) until an operator sets it to the provider's value. See DEPLOYMENT.md.
    this.appSecret = new secretsmanager.Secret(this, 'AppSecret', {
      secretName: n.appSecret,
      description: 'Qitah API application secrets (webhook signing secrets). Set real provider values before go-live.',
      encryptionKey: this.dataKey,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ CARRIER_WEBHOOK_SECRET: '' }),
        generateStringKey: 'PAYMENT_WEBHOOK_SECRET',
        passwordLength: 48,
        excludePunctuation: true,
      },
      removalPolicy: removal,
    });

    // ---------- RDS PostgreSQL 16 ----------
    const parameterGroup = new rds.ParameterGroup(this, 'DbParams', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      description: 'Qitah PostgreSQL 16 - TLS enforced',
      parameters: {
        'rds.force_ssl': '1',
        log_min_duration_statement: '1000',
        log_connections: '1',
        log_disconnections: '1',
        // OLTP: LLVM JIT compiles catalog/search queries for 50–300 ms that run in tens of ms (load test, services/api/scripts/loadtest).
        jit: '0',
      },
    });

    this.db = new rds.DatabaseInstance(this, 'Db', {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: new ec2.InstanceType(config.database.instanceType),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      publiclyAccessible: false,
      multiAz: config.database.multiAz,
      databaseName: config.database.databaseName,
      credentials: rds.Credentials.fromGeneratedSecret('qitah_admin', {
        secretName: n.dbSecret,
        encryptionKey: this.dataKey,
        excludeCharacters: ' %+~`#$&*()|[]{}:;<>?!\'/@"\\',
      }),
      parameterGroup,
      allocatedStorage: config.database.allocatedStorageGiB,
      maxAllocatedStorage: config.database.maxAllocatedStorageGiB,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: this.dataKey,
      backupRetention: Duration.days(config.database.backupRetentionDays),
      preferredBackupWindow: '00:00-01:00', // 03:00-04:00 KSA
      preferredMaintenanceWindow: 'fri:01:30-fri:02:30',
      deleteAutomatedBackups: !prod,
      deletionProtection: config.database.deletionProtection,
      removalPolicy: config.database.snapshotOnDelete ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
      copyTagsToSnapshot: true,
      autoMinorVersionUpgrade: true,
      enablePerformanceInsights: true,
      performanceInsightRetention: config.database.performanceInsightsRetentionDays as rds.PerformanceInsightRetention,
      performanceInsightEncryptionKey: this.dataKey,
      monitoringInterval: Duration.seconds(60),
      cloudwatchLogsExports: ['postgresql', 'upgrade'],
      caCertificate: rds.CaCertificate.RDS_CA_RSA2048_G1,
    });
    this.dbSecret = this.db.secret!;

    if (config.database.rotationDays) {
      this.db.addRotationSingleUser({
        automaticallyAfter: Duration.days(config.database.rotationDays),
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      });
    }

    // ---------- AWS Backup (in addition to RDS automated backups / PITR) ----------
    if (config.backup.enabled) {
      // (IAM4 for the AWS Backup service role is acknowledged on the plan below.)
      const vault = new backup.BackupVault(this, 'BackupVault', {
        backupVaultName: `qitah-${config.envName}-vault`,
        encryptionKey: this.dataKey,
        removalPolicy: removal,
      });
      const plan = new backup.BackupPlan(this, 'BackupPlan', { backupPlanName: `qitah-${config.envName}-daily`, backupVault: vault });
      plan.addRule(
        new backup.BackupPlanRule({
          ruleName: 'daily',
          scheduleExpression: events.Schedule.cron({ hour: '1', minute: '30' }), // 04:30 KSA
          startWindow: Duration.hours(1),
          completionWindow: Duration.hours(4),
          deleteAfter: Duration.days(config.backup.retentionDays),
          copyActions: config.backup.crossRegionCopyVaultArn
            ? [
                {
                  destinationBackupVault: backup.BackupVault.fromBackupVaultArn(this, 'CopyVault', config.backup.crossRegionCopyVaultArn),
                  deleteAfter: Duration.days(config.backup.retentionDays),
                },
              ]
            : undefined,
        }),
      );
      plan.addSelection('Rds', { resources: [backup.BackupResource.fromRdsDatabaseInstance(this.db)] });
      acknowledge(plan, [
        {
          id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSBackupServiceRolePolicyForBackup]',
          reason: 'AWS-managed service role policy required by AWS Backup to snapshot RDS.',
        },
      ]);
    }

    new CfnOutput(this, 'DbEndpoint', { value: this.db.dbInstanceEndpointAddress });
    new CfnOutput(this, 'DbInstanceId', { value: this.db.instanceIdentifier });
    new CfnOutput(this, 'DbSecretArn', { value: this.dbSecret.secretArn });
    new CfnOutput(this, 'AppSecretArn', { value: this.appSecret.secretArn });
    new CfnOutput(this, 'UploadsBucketName', { value: this.uploadsBucket.bucketName });
    new CfnOutput(this, 'JobsQueueUrl', { value: this.jobsQueue.queueUrl });

    // ---------- cdk-nag suppressions (with justification) ----------
    acknowledge(this.logsBucket, [
      { id: 'AwsSolutions-S1', reason: 'This IS the access-log destination bucket; logging it to itself would recurse.' },
    ]);
    acknowledge(this.db, [
      {
        id: 'AwsSolutions-RDS11',
        reason: 'Default port 5432 is used; the instance is in isolated subnets and reachable only from ECS security groups.',
      },
      {
        id: 'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AmazonRDSEnhancedMonitoringRole]',
        reason: 'AmazonRDSEnhancedMonitoringRole is the AWS-managed policy required by RDS enhanced monitoring.',
      },
    ]);
    if (!config.database.rotationDays) {
      acknowledge(this.db, [
        {
          id: 'AwsSolutions-SMG4',
          reason: 'Rotation is a config option (database.rotationDays). Off by default because ECS tasks read the password at start; see DEPLOYMENT.md.',
        },
      ]);
    }
    acknowledge(this.appSecret, [
      { id: 'AwsSolutions-SMG4', reason: 'Webhook signing secrets are issued by the payment/carrier providers and rotated with them, not by a Lambda.' },
    ]);
    if (!config.database.multiAz) {
      acknowledge(this.db, [{ id: 'AwsSolutions-RDS3', reason: 'Staging runs single-AZ for cost; production is Multi-AZ.' }]);
    }
    if (!config.database.deletionProtection) {
      acknowledge(this.db, [{ id: 'AwsSolutions-RDS10', reason: 'Staging is disposable; production enables deletion protection.' }]);
    }
  }
}
