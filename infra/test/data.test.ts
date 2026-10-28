import { Match } from 'aws-cdk-lib/assertions';

import { resources, stage, template } from './helpers';

describe.each(['staging', 'production'] as const)('Data stack (%s)', (env) => {
  const data = stage(env).stacks.data;
  const t = template(data);
  const prod = env === 'production';

  test('RDS PostgreSQL 16 is private, encrypted with the KMS key, in isolated subnets', () => {
    t.hasResourceProperties('AWS::RDS::DBInstance', {
      Engine: 'postgres',
      EngineVersion: Match.stringLikeRegexp('^16'),
      PubliclyAccessible: false,
      StorageEncrypted: true,
      KmsKeyId: Match.objectLike({ 'Fn::GetAtt': [Match.stringLikeRegexp('^DataKey'), 'Arn'] }),
      EnablePerformanceInsights: true,
      MultiAZ: prod,
      DeletionProtection: prod,
      BackupRetentionPeriod: prod ? 30 : 7,
      DBInstanceClass: prod ? 'db.t4g.medium' : 'db.t4g.micro',
    });
    t.hasResourceProperties('AWS::RDS::DBSubnetGroup', {
      SubnetIds: Match.arrayWith([Match.objectLike({ 'Fn::ImportValue': Match.stringLikeRegexp('dataSubnet') })]),
    });
  });

  test('RDS deletion behaviour: snapshot in production, destroy in staging', () => {
    const db = Object.values(resources(data)).find((r) => r.Type === 'AWS::RDS::DBInstance')!;
    expect(db.DeletionPolicy).toBe(prod ? 'Snapshot' : 'Delete');
  });

  test('parameter group forces SSL', () => {
    t.hasResourceProperties('AWS::RDS::DBParameterGroup', { Parameters: Match.objectLike({ 'rds.force_ssl': '1', jit: '0' }) });
  });

  test('DB credentials are generated into Secrets Manager with the data key', () => {
    t.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: `qitah/${env}/db`,
      KmsKeyId: Match.anyValue(),
      GenerateSecretString: Match.objectLike({ GenerateStringKey: 'password' }),
    });
  });

  test('every bucket blocks public access and enforces TLS', () => {
    const buckets = Object.entries(resources(data)).filter(([, r]) => r.Type === 'AWS::S3::Bucket');
    expect(buckets.length).toBe(2);
    for (const [, b] of buckets) {
      expect(b.Properties?.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      });
    }
    const policies = Object.values(resources(data)).filter((r) => r.Type === 'AWS::S3::BucketPolicy');
    expect(policies.length).toBe(2);
    for (const p of policies) {
      expect(JSON.stringify(p.Properties)).toContain('"aws:SecureTransport":"false"');
    }
  });

  test('uploads bucket: SSE-KMS, versioning, lifecycle, access logging, CORS PUT', () => {
    t.hasResourceProperties('AWS::S3::Bucket', {
      BucketName: `qitah-${env}-uploads-${env === 'production' ? '222222222222' : '111111111111'}-eu-central-1`,
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [
          Match.objectLike({ ServerSideEncryptionByDefault: Match.objectLike({ SSEAlgorithm: 'aws:kms' }), BucketKeyEnabled: true }),
        ],
      },
      VersioningConfiguration: { Status: 'Enabled' },
      LoggingConfiguration: Match.objectLike({ LogFilePrefix: 's3/uploads/' }),
      LifecycleConfiguration: { Rules: Match.arrayWith([Match.objectLike({ Id: 'labels-to-ia', Prefix: 'shipping-labels/' })]) },
      CorsConfiguration: { CorsRules: [Match.objectLike({ AllowedMethods: Match.arrayWith(['PUT', 'GET']) })] },
    });
  });

  test('jobs queue: KMS-encrypted with a DLQ redrive', () => {
    t.hasResourceProperties('AWS::SQS::Queue', {
      QueueName: `qitah-${env}-jobs`,
      KmsMasterKeyId: Match.anyValue(),
      RedrivePolicy: Match.objectLike({ maxReceiveCount: 5, deadLetterTargetArn: Match.anyValue() }),
    });
    t.hasResourceProperties('AWS::SQS::Queue', { QueueName: `qitah-${env}-jobs-dlq`, KmsMasterKeyId: Match.anyValue() });
  });

  test('AWS Backup daily plan for RDS', () => {
    t.hasResourceProperties('AWS::Backup::BackupPlan', {
      BackupPlan: {
        BackupPlanName: `qitah-${env}-daily`,
        BackupPlanRule: [Match.objectLike({ Lifecycle: { DeleteAfterDays: prod ? 35 : 14 } })],
      },
    });
    t.resourceCountIs('AWS::Backup::BackupSelection', 1);
  });

  test('KMS key rotation is enabled', () => {
    t.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });
});
