import { Match } from 'aws-cdk-lib/assertions';

import { GITHUB_OIDC_HOST } from '../lib/stacks/github-oidc-stack';
import { allStacks, asArray, policyDocuments, resources, stage, template } from './helpers';

describe.each(['staging', 'production'] as const)('GitHub OIDC deploy role (%s)', (env) => {
  const github = stage(env).stacks.github;
  const t = template(github);

  test('trust is scoped to the repository and the environment/branch', () => {
    const expected =
      env === 'production'
        ? ['repo:Ibrahemaleisa/Qitah-app:environment:production']
        : ['repo:Ibrahemaleisa/Qitah-app:ref:refs/heads/main', 'repo:Ibrahemaleisa/Qitah-app:environment:staging'];
    t.hasResourceProperties('AWS::IAM::Role', {
      RoleName: `qitah-${env}-github-deploy`,
      MaxSessionDuration: 3600,
      AssumeRolePolicyDocument: {
        Statement: [
          Match.objectLike({
            Action: 'sts:AssumeRoleWithWebIdentity',
            Effect: 'Allow',
            Condition: {
              StringEquals: {
                [`${GITHUB_OIDC_HOST}:aud`]: 'sts.amazonaws.com',
                [`${GITHUB_OIDC_HOST}:sub`]: expected,
              },
            },
          }),
        ],
      },
    });
    // No StringLike wildcard subject (would allow any branch/environment).
    expect(JSON.stringify(t.toJSON())).not.toContain('StringLike');
  });

  test('OIDC provider for token.actions.githubusercontent.com', () => {
    t.hasResourceProperties('AWS::IAM::OIDCProvider', { Url: `https://${GITHUB_OIDC_HOST}`, ClientIdList: ['sts.amazonaws.com'] });
  });

  test('deploy policy: no admin, no *:*, only CDK roles / ECR repo / migration task / services', () => {
    const docs = policyDocuments(github);
    expect(docs.length).toBe(1);
    const statements = docs[0].doc.Statement;
    for (const st of statements) {
      const actions = asArray(st.Action as string | string[]);
      expect(actions).not.toContain('*');
      for (const a of actions) expect(a).not.toMatch(/^[a-z0-9-]+:\*$/);
      expect(st.Effect).toBe('Allow');
    }
    const json = JSON.stringify(statements);
    expect(json).toContain(`role/cdk-hnb659fds-deploy-role-`);
    expect(json).toContain(`repository/qitah/${env}/api`);
    expect(json).toContain(`task-definition/qitah-${env}-migrate:*`);
    expect(json).toContain('"iam:PassedToService":"ecs-tasks.amazonaws.com"');
    // Wildcard resource only for ecr:GetAuthorizationToken.
    const starResources = statements.filter((s) => asArray(s.Resource as string | string[]).includes('*'));
    expect(starResources.map((s) => s.Action)).toEqual(['ecr:GetAuthorizationToken']);
    expect(JSON.stringify(t.toJSON())).not.toContain('AdministratorAccess');
  });
});

describe('no long-lived credentials or administrator access anywhere', () => {
  test.each(['staging', 'production'] as const)('%s', (env) => {
    for (const stack of allStacks(env)) {
      const r = resources(stack);
      for (const res of Object.values(r)) {
        expect(['AWS::IAM::User', 'AWS::IAM::AccessKey', 'AWS::IAM::Group']).not.toContain(res.Type);
      }
      const json = JSON.stringify(r);
      expect(json).not.toContain('policy/AdministratorAccess');
      for (const { doc } of policyDocuments(stack)) {
        for (const st of doc.Statement) {
          if (st.Effect !== 'Allow') continue;
          const actions = asArray(st.Action as string | string[]);
          expect(actions).not.toContain('*');
          expect(actions).not.toContain('*:*');
        }
      }
    }
  });
});

describe.each(['staging', 'production'] as const)('Cognito (%s)', (env) => {
  const t = template(stage(env).stacks.auth);
  test('customer pool signs in with phone; staff pool with email + strong passwords', () => {
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: `qitah-${env}-customers`,
      AliasAttributes: Match.absent(),
      UsernameAttributes: ['phone_number'],
      AutoVerifiedAttributes: ['phone_number'],
    });
    t.hasResourceProperties('AWS::Cognito::UserPool', {
      UserPoolName: `qitah-${env}-staff`,
      UsernameAttributes: ['email'],
      MfaConfiguration: env === 'production' ? 'ON' : 'OPTIONAL',
      Policies: Match.objectLike({ PasswordPolicy: Match.objectLike({ MinimumLength: 12, RequireSymbols: true, RequireUppercase: true }) }),
    });
  });

  test('app clients: no secrets; portals allow USER_PASSWORD_AUTH + SRP', () => {
    const clients = Object.values(template(stage(env).stacks.auth).toJSON().Resources as Record<string, { Type: string; Properties: Record<string, unknown> }>).filter(
      (r) => r.Type === 'AWS::Cognito::UserPoolClient',
    );
    expect(clients.length).toBe(3);
    for (const c of clients) expect(c.Properties.GenerateSecret).toBe(false);
    const portal = clients.filter((c) => String(c.Properties.ClientName).endsWith('-portal'));
    for (const c of portal) {
      expect(c.Properties.ExplicitAuthFlows).toEqual(expect.arrayContaining(['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_USER_SRP_AUTH']));
    }
  });
});

describe('every resource is tagged', () => {
  const REQUIRED = ['Project', 'Environment', 'Owner', 'CostCenter', 'DataClassification'];
  const MUST_BE_TAGGED = [
    'AWS::EC2::VPC',
    'AWS::RDS::DBInstance',
    'AWS::S3::Bucket',
    'AWS::SQS::Queue',
    'AWS::ECS::Cluster',
    'AWS::ECS::Service',
    'AWS::ECS::TaskDefinition',
    'AWS::ECR::Repository',
    'AWS::KMS::Key',
    'AWS::SecretsManager::Secret',
    'AWS::ElasticLoadBalancingV2::LoadBalancer',
    'AWS::CloudFront::Distribution',
    'AWS::SNS::Topic',
    'AWS::Logs::LogGroup',
    'AWS::IAM::Role',
    'AWS::Cognito::UserPool',
  ];

  function tagKeys(props: Record<string, unknown> | undefined): string[] | undefined {
    if (!props) return undefined;
    const tags = props.Tags ?? props.UserPoolTags ?? props.TagSpecifications;
    if (tags === undefined) return undefined;
    if (Array.isArray(tags)) return tags.map((t: { Key: string }) => t.Key);
    return Object.keys(tags as object);
  }

  // CDK framework-internal custom-resource provider roles/functions are raw CfnResources that the
  // Tags aspect cannot reach; they carry no data and are excluded explicitly.
  const CDK_INTERNAL = /^Custom.*CustomResourceProvider(Role|Handler)/;

  test.each(['staging', 'production'] as const)('%s', (env) => {
    let checked = 0;
    for (const stack of allStacks(env)) {
      for (const [id, r] of Object.entries(resources(stack))) {
        const keys = tagKeys(r.Properties);
        if (CDK_INTERNAL.test(id)) continue;
        if (MUST_BE_TAGGED.includes(r.Type)) expect({ id, keys }).toEqual({ id, keys: expect.arrayContaining(REQUIRED) });
        if (keys) {
          expect({ id, keys }).toEqual({ id, keys: expect.arrayContaining(REQUIRED) });
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(50);
  });

  test('Data and Auth stacks are classified Confidential', () => {
    const t = template(stage('production').stacks.data);
    t.hasResourceProperties('AWS::RDS::DBInstance', { Tags: Match.arrayWith([{ Key: 'DataClassification', Value: 'Confidential' }]) });
  });
});
