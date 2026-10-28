import { Match } from 'aws-cdk-lib/assertions';

import { ORIGIN_VERIFY_HEADER } from '../lib/names';
import { IMAGE_TAG, resources, stage, template } from './helpers';

describe.each(['staging', 'production'] as const)('Network / edge / compute (%s)', (env) => {
  const { network, api, migrations, platform } = stage(env).stacks;
  const prod = env === 'production';

  test('VPC has public, private-with-egress and isolated subnets in 2 AZs; NAT count per env', () => {
    const t = template(network);
    t.resourceCountIs('AWS::EC2::Subnet', 6);
    t.resourceCountIs('AWS::EC2::NatGateway', prod ? 2 : 1);
    t.resourceCountIs('AWS::EC2::FlowLog', 1);
    t.hasResourceProperties('AWS::EC2::VPCEndpoint', { VpcEndpointType: 'Gateway', ServiceName: Match.anyValue() });
    const interfaceEndpoints = Object.values(resources(network)).filter(
      (r) => r.Type === 'AWS::EC2::VPCEndpoint' && r.Properties?.VpcEndpointType === 'Interface',
    );
    expect(interfaceEndpoints.length).toBe(prod ? 5 : 0);
  });

  test('ALB security group only admits the CloudFront origin-facing prefix list', () => {
    const r = resources(network);
    const albSgId = Object.keys(r).find((k) => k.startsWith('AlbSg') && r[k].Type === 'AWS::EC2::SecurityGroup')!;
    const sg = r[albSgId];
    // No inline CIDR ingress at all on the ALB SG.
    expect(sg.Properties?.SecurityGroupIngress ?? []).toEqual(
      (sg.Properties?.SecurityGroupIngress as Array<Record<string, unknown>> | undefined)?.filter((i) => i.SourcePrefixListId) ?? [],
    );
    const ingress = Object.values(r).filter(
      (x) => x.Type === 'AWS::EC2::SecurityGroupIngress' && JSON.stringify(x.Properties?.GroupId).includes(albSgId),
    );
    const inline = (sg.Properties?.SecurityGroupIngress as Array<Record<string, unknown>> | undefined) ?? [];
    const all = [...inline, ...ingress.map((i) => i.Properties as Record<string, unknown>)];
    expect(all.length).toBeGreaterThan(0);
    for (const rule of all) {
      expect(rule.SourcePrefixListId).toBeDefined();
      expect(rule.CidrIp).toBeUndefined();
      expect(rule.CidrIpv6).toBeUndefined();
    }
    // The prefix list id is resolved at deploy time by name (no synth-time lookup).
    expect(JSON.stringify(r)).toContain('com.amazonaws.global.cloudfront.origin-facing');
  });

  test('DB security group only admits the ECS security groups on 5432', () => {
    const r = resources(network);
    const dbSgId = Object.keys(r).find((k) => k.startsWith('DbSg') && r[k].Type === 'AWS::EC2::SecurityGroup')!;
    const rules = Object.values(r).filter(
      (x) => x.Type === 'AWS::EC2::SecurityGroupIngress' && JSON.stringify(x.Properties?.GroupId).includes(dbSgId),
    );
    expect(rules.length).toBe(3);
    for (const rule of rules) {
      expect(rule.Properties?.FromPort).toBe(5432);
      expect(rule.Properties?.SourceSecurityGroupId).toBeDefined();
      expect(rule.Properties?.CidrIp).toBeUndefined();
    }
  });

  test('ALB listener defaults to 403 and forwards only with the secret origin header', () => {
    const t = template(api);
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::Listener', {
      DefaultActions: [Match.objectLike({ Type: 'fixed-response', FixedResponseConfig: Match.objectLike({ StatusCode: '403' }) })],
    });
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
      Conditions: [
        Match.objectLike({
          Field: 'http-header',
          HttpHeaderConfig: { HttpHeaderName: ORIGIN_VERIFY_HEADER, Values: [Match.objectLike({ 'Fn::Join': Match.anyValue() })] },
        }),
      ],
      Actions: [Match.objectLike({ Type: 'forward' })],
    });
    // Secret value is a Secrets Manager dynamic reference, never a literal in the template.
    expect(JSON.stringify(template(api).toJSON())).toContain('{{resolve:secretsmanager:');
    t.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', { HealthCheckPath: '/ready', TargetType: 'ip', Port: 4000 });
  });

  test('CloudFront: HTTPS only, caching disabled, all viewer headers (Authorization) and query strings forwarded', () => {
    const t = template(api);
    t.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({
          ViewerProtocolPolicy: 'https-only',
          CachePolicyId: '4135ea2d-6df8-44a3-9df3-4b5a84be39ad', // Managed-CachingDisabled
          OriginRequestPolicyId: 'b689b0a8-53d0-40ab-baf2-68738e2966ac', // Managed-AllViewerExceptHostHeader
        }),
        Origins: [Match.objectLike({ OriginCustomHeaders: [Match.objectLike({ HeaderName: ORIGIN_VERIFY_HEADER })] })],
        PriceClass: 'PriceClass_200',
      }),
    });
    const dist = Object.values(resources(api)).find((r) => r.Type === 'AWS::CloudFront::Distribution')!;
    const cfg = dist.Properties?.DistributionConfig as Record<string, unknown>;
    if (prod) expect(cfg.WebACLId).toBeDefined();
    else expect(cfg.WebACLId).toBeUndefined();
  });

  test('CloudFront: public catalog GETs are cached by path + query string (+ Origin), never by or with Authorization', () => {
    const t = template(api);
    t.hasResourceProperties('AWS::CloudFront::CachePolicy', {
      CachePolicyConfig: Match.objectLike({
        Name: `qitah-${env}-public-catalog`,
        DefaultTTL: 0, // only what the API marks cacheable (honours origin Cache-Control)
        MinTTL: 0,
        MaxTTL: 86400,
        ParametersInCacheKeyAndForwardedToOrigin: Match.objectLike({
          QueryStringsConfig: { QueryStringBehavior: 'all' },
          CookiesConfig: { CookieBehavior: 'none' },
          HeadersConfig: { HeaderBehavior: 'whitelist', Headers: ['Origin'] },
          EnableAcceptEncodingGzip: true,
          EnableAcceptEncodingBrotli: true,
        }),
      }),
    });
    const dist = Object.values(resources(api)).find((r) => r.Type === 'AWS::CloudFront::Distribution')!;
    const cfg = dist.Properties?.DistributionConfig as { CacheBehaviors: Array<Record<string, unknown>> };
    expect(cfg.CacheBehaviors).toHaveLength(1);
    const catalog = cfg.CacheBehaviors[0];
    expect(catalog.PathPattern).toBe('/v1/catalog/*');
    expect(catalog.ViewerProtocolPolicy).toBe('https-only');
    expect(catalog.AllowedMethods).toEqual(['GET', 'HEAD', 'OPTIONS']);
    expect(catalog.CachedMethods).toEqual(['GET', 'HEAD']);
    // No origin request policy: Authorization / cookies are not forwarded on cacheable responses.
    expect(catalog.OriginRequestPolicyId).toBeUndefined();
    const policy = JSON.stringify(Object.values(resources(api)).find((r) => r.Type === 'AWS::CloudFront::CachePolicy'));
    expect(policy).not.toContain('Authorization');
  });

  test('WAF web ACL (production) uses managed rule groups and a rate limit', () => {
    const edge = stage(env).stacks.edge;
    if (!prod) {
      expect(edge).toBeUndefined();
      return;
    }
    expect(edge!.region).toBe('us-east-1');
    const t = template(edge!);
    t.hasResourceProperties('AWS::WAFv2::WebACL', {
      Scope: 'CLOUDFRONT',
      Rules: Match.arrayWith([
        Match.objectLike({ Statement: { RateBasedStatement: Match.objectLike({ AggregateKeyType: 'IP' }) } }),
        Match.objectLike({ Statement: { ManagedRuleGroupStatement: Match.objectLike({ Name: 'AWSManagedRulesAmazonIpReputationList' }) } }),
        Match.objectLike({ Statement: { ManagedRuleGroupStatement: Match.objectLike({ Name: 'AWSManagedRulesCommonRuleSet' }) } }),
        Match.objectLike({ Statement: { ManagedRuleGroupStatement: Match.objectLike({ Name: 'AWSManagedRulesKnownBadInputsRuleSet' }) } }),
      ]),
    });
  });

  test('ECS services: circuit breaker with rollback, private subnets, no public IP', () => {
    const t = template(api);
    const services = Object.values(resources(api)).filter((r) => r.Type === 'AWS::ECS::Service');
    expect(services.length).toBe(2);
    for (const s of services) {
      expect(s.Properties?.DeploymentConfiguration).toMatchObject({ DeploymentCircuitBreaker: { Enable: true, Rollback: true } });
      expect(s.Properties?.NetworkConfiguration).toMatchObject({ AwsvpcConfiguration: { AssignPublicIp: 'DISABLED' } });
    }
    t.resourceCountIs('AWS::ApplicationAutoScaling::ScalingPolicy', 2);
  });

  test('secrets are injected from Secrets Manager, never as plain environment', () => {
    const secretNames = ['DB_PASSWORD', 'DB_USER', 'DB_HOST', 'PAYMENT_WEBHOOK_SECRET', 'CARRIER_WEBHOOK_SECRET', 'DATABASE_URL', 'JWT_SECRET'];
    for (const stack of [api, migrations]) {
      for (const td of Object.values(resources(stack)).filter((r) => r.Type === 'AWS::ECS::TaskDefinition')) {
        for (const c of td.Properties?.ContainerDefinitions as Array<Record<string, unknown>>) {
          const envNames = ((c.Environment as Array<{ Name: string }>) ?? []).map((e) => e.Name);
          for (const n of secretNames) expect(envNames).not.toContain(n);
          const secrets = ((c.Secrets as Array<{ Name: string }>) ?? []).map((s) => s.Name);
          expect(secrets).toEqual(expect.arrayContaining(['DB_HOST', 'DB_PORT', 'DB_USER', 'DB_PASSWORD']));
          expect(JSON.stringify(c.Image)).toContain(IMAGE_TAG);
        }
      }
    }
  });

  test('API/worker env matches services/api/src/config.ts for AWS (cognito, uploads bucket, queue)', () => {
    const td = Object.values(resources(api)).find((r) => r.Type === 'AWS::ECS::TaskDefinition' && JSON.stringify(r).includes('dist/main.js'))!;
    const c = (td.Properties?.ContainerDefinitions as Array<Record<string, unknown>>)[0];
    const envMap = Object.fromEntries((c.Environment as Array<{ Name: string; Value: unknown }>).map((e) => [e.Name, e.Value]));
    expect(envMap.AUTH_MODE).toBe('cognito');
    expect(envMap.NODE_ENV).toBe(env);
    expect(envMap.DB_SSLMODE).toBe('require');
    expect(envMap.ALLOW_SANDBOX_IN_PRODUCTION).toBe('false');
    for (const k of ['COGNITO_REGION', 'COGNITO_USER_POOL_ID', 'COGNITO_CLIENT_IDS', 'UPLOADS_BUCKET', 'JOBS_QUEUE_URL', 'PUBLIC_BASE_URL']) {
      expect(envMap[k]).toBeDefined();
    }
    expect(envMap.RATE_LIMIT_SCALE).toBeUndefined();
    expect(c.ReadonlyRootFilesystem).toBe(true);
  });

  test('migration task definition runs prisma migrate deploy with fixed family/roles', () => {
    const t = template(migrations);
    t.hasResourceProperties('AWS::ECS::TaskDefinition', {
      Family: `qitah-${env}-migrate`,
      ContainerDefinitions: [Match.objectLike({ Command: ['npx', 'prisma', 'migrate', 'deploy'] })],
    });
    t.hasResourceProperties('AWS::IAM::Role', { RoleName: `qitah-${env}-migrate-task` });
    t.hasResourceProperties('AWS::IAM::Role', { RoleName: `qitah-${env}-migrate-exec` });
  });

  test('task roles are least privilege: no s3:*, no sqs:*, prefixes only', () => {
    const json = JSON.stringify(template(api).toJSON());
    expect(json).not.toMatch(/"s3:\*"|"sqs:\*"|"kms:\*"|"s3:List\*"/);
    expect(json).toContain('/merchants/*');
    expect(json).toContain('/shipping-labels/*');
  });

  test('ECR: scan on push, immutable tags, lifecycle; cluster has Container Insights', () => {
    const t = template(platform);
    t.hasResourceProperties('AWS::ECR::Repository', {
      RepositoryName: `qitah/${env}/api`,
      ImageScanningConfiguration: { ScanOnPush: true },
      ImageTagMutability: 'IMMUTABLE',
      LifecyclePolicy: Match.anyValue(),
    });
    t.hasResourceProperties('AWS::ECS::Cluster', {
      ClusterName: `qitah-${env}`,
      ClusterSettings: [{ Name: 'containerInsights', Value: 'enabled' }],
    });
  });

  test('log groups have retention (30d staging / 90d production)', () => {
    const t = template(api);
    t.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: `/qitah/${env}/api`, RetentionInDays: prod ? 90 : 30 });
    t.hasResourceProperties('AWS::Logs::LogGroup', { LogGroupName: `/qitah/${env}/worker`, RetentionInDays: prod ? 90 : 30 });
  });
});
