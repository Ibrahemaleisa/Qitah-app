import { Match } from 'aws-cdk-lib/assertions';

import { resources, stage, template } from './helpers';

describe.each(['staging', 'production'] as const)('Monitoring (%s)', (env) => {
  const mon = stage(env).stacks.monitoring;
  const t = template(mon);

  test('DLQ depth alarm notifies the alarm topic', () => {
    t.hasResourceProperties('AWS::CloudWatch::Alarm', {
      AlarmName: `qitah-${env}-jobs-dlq-messages`,
      MetricName: 'ApproximateNumberOfMessagesVisible',
      Namespace: 'AWS/SQS',
      Threshold: 0,
      ComparisonOperator: 'GreaterThanThreshold',
      AlarmActions: [Match.objectLike({ Ref: Match.stringLikeRegexp('^AlarmTopic') })],
    });
  });

  test('all required alarms exist', () => {
    const names = Object.values(resources(mon))
      .filter((r) => r.Type === 'AWS::CloudWatch::Alarm')
      .map((r) => String(r.Properties?.AlarmName).replace(`qitah-${env}-`, ''));
    expect(names).toEqual(
      expect.arrayContaining([
        'alb-5xx-rate',
        'target-5xx',
        'unhealthy-hosts',
        'p95-latency',
        'api-cpu',
        'api-memory',
        'worker-cpu',
        'worker-memory',
        'worker-not-running',
        'rds-cpu',
        'rds-free-storage',
        'rds-connections',
        'rds-freeable-memory',
        'jobs-dlq-messages',
        'jobs-oldest-message',
        'api-error-logs',
      ]),
    );
  });

  test('pino error-level metric filter', () => {
    t.hasResourceProperties('AWS::Logs::MetricFilter', { FilterPattern: '{ $.level >= 50 }', MetricTransformations: [Match.objectLike({ MetricName: 'ApiErrorLogs' })] });
  });

  test('budgets: actual and forecast at 50/80/100% to the topic', () => {
    const budgets = Object.values(resources(mon)).filter((r) => r.Type === 'AWS::Budgets::Budget');
    expect(budgets.length).toBe(2);
    const types = new Set<string>();
    for (const b of budgets) {
      const ns = b.Properties?.NotificationsWithSubscribers as Array<{ Notification: { Threshold: number; NotificationType: string } }>;
      expect(ns.map((n) => n.Notification.Threshold)).toEqual([50, 80, 100]);
      types.add(ns[0].Notification.NotificationType);
    }
    expect([...types].sort()).toEqual(['ACTUAL', 'FORECASTED']);
    t.hasResourceProperties('AWS::Budgets::Budget', {
      Budget: Match.objectLike({ BudgetLimit: { Amount: env === 'production' ? 900 : 250, Unit: 'USD' }, TimeUnit: 'MONTHLY' }),
    });
  });

  test('dashboard and email subscription', () => {
    t.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
    t.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email' });
  });
});

describe.each(['staging', 'production'] as const)('Amplify Hosting (%s)', (env) => {
  const hosting = stage(env).stacks.hosting!;
  const t = template(hosting);

  test('two WEB_COMPUTE apps with monorepo app roots and server-only env vars', () => {
    for (const root of ['portals/merchant', 'portals/ops']) {
      t.hasResourceProperties('AWS::Amplify::App', {
        Platform: 'WEB_COMPUTE',
        BuildSpec: Match.stringLikeRegexp(`appRoot: ${root}`),
        EnvironmentVariables: Match.arrayWith([
          { Name: 'AMPLIFY_MONOREPO_APP_ROOT', Value: root },
          Match.objectLike({ Name: 'API_BASE_URL' }),
          { Name: 'AUTH_MODE', Value: 'cognito' },
          { Name: 'COGNITO_REGION', Value: 'eu-central-1' },
          Match.objectLike({ Name: 'COGNITO_CLIENT_ID' }),
        ]),
      });
    }
  });

  test('GitHub token comes from Secrets Manager (dynamic reference), never a literal', () => {
    const json = JSON.stringify(t.toJSON());
    expect(json).toContain(`{{resolve:secretsmanager:qitah/${env}/amplify-github-token:SecretString:::}}`);
  });

  test('staging protects branches with basic auth from a secret', () => {
    const json = JSON.stringify(t.toJSON());
    if (env === 'staging') expect(json).toContain('qitah/staging/amplify-basic-auth');
    else expect(json).not.toContain('amplify-basic-auth');
  });
});
