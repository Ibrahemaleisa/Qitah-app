import { CfnOutput, Duration, Stack, type StackProps } from 'aws-cdk-lib';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import type * as rds from 'aws-cdk-lib/aws-rds';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import type * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { names } from '../names';
import { statefulRemoval } from '../util';

export interface MonitoringStackProps extends StackProps {
  config: QitahConfig;
  alb: elbv2.IApplicationLoadBalancer;
  targetGroup: elbv2.IApplicationTargetGroup;
  apiService: ecs.FargateService;
  workerService: ecs.FargateService;
  clusterName: string;
  apiLogGroup: logs.ILogGroup;
  workerLogGroup: logs.ILogGroup;
  db: rds.IDatabaseInstance;
  jobsQueue: sqs.IQueue;
  jobsDlq: sqs.IQueue;
}

/** Alarm topic, CloudWatch alarms, dashboard, log metric filters and AWS Budgets. */
export class MonitoringStack extends Stack {
  readonly topic: sns.Topic;
  readonly alarms: cloudwatch.Alarm[] = [];

  constructor(scope: Construct, id: string, props: MonitoringStackProps) {
    super(scope, id, props);
    const { config } = props;
    const m = config.monitoring;
    const n = names(config.envName);
    const prefix = `qitah-${config.envName}`;

    // Customer-managed key so CloudWatch and Budgets can publish to the encrypted topic.
    const topicKey = new kms.Key(this, 'AlarmTopicKey', {
      alias: `alias/${prefix}-alarms`,
      description: 'Encrypts the Qitah alarm SNS topic',
      enableKeyRotation: true,
      removalPolicy: statefulRemoval(config),
    });
    for (const service of ['cloudwatch.amazonaws.com', 'budgets.amazonaws.com']) {
      topicKey.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: `Allow-${service.split('.')[0]}`,
          principals: [new iam.ServicePrincipal(service)],
          actions: ['kms:Decrypt', 'kms:GenerateDataKey*'],
          resources: ['*'],
          conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
        }),
      );
    }
    this.topic = new sns.Topic(this, 'AlarmTopic', { topicName: `${prefix}-alarms`, displayName: `Qitah ${config.envName} alarms`, masterKey: topicKey, enforceSSL: true });
    this.topic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowBudgets',
        principals: [new iam.ServicePrincipal('budgets.amazonaws.com')],
        actions: ['sns:Publish'],
        resources: [this.topic.topicArn],
        conditions: { StringEquals: { 'aws:SourceAccount': this.account } },
      }),
    );
    for (const email of m.alarmEmails) this.topic.addSubscription(new subs.EmailSubscription(email));
    const action = new cwActions.SnsAction(this.topic);

    const alarm = (id: string, a: cloudwatch.CreateAlarmOptions & { metric: cloudwatch.IMetric }) => {
      const created = new cloudwatch.Alarm(this, id, { alarmName: `${prefix}-${id}`, ...a });
      created.addAlarmAction(action);
      created.addOkAction(action);
      this.alarms.push(created);
      return created;
    };
    const five = Duration.minutes(5);
    const one = Duration.minutes(1);

    // ---------- ALB / API ----------
    const alb = props.alb.metrics;
    const requests = alb.requestCount({ period: five, statistic: 'Sum' });
    alarm('alb-5xx-rate', {
      metric: new cloudwatch.MathExpression({
        expression: 'IF(req > 20, 100 * (elb5xx + tgt5xx) / req, 0)',
        usingMetrics: {
          req: requests,
          elb5xx: alb.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: five, statistic: 'Sum' }),
          tgt5xx: alb.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: five, statistic: 'Sum' }),
        },
        label: '5xx % of requests',
        period: five,
      }),
      threshold: m.alb5xxPercent,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: `ALB+target 5xx above ${m.alb5xxPercent}% of requests`,
    });
    alarm('target-5xx', {
      metric: props.targetGroup.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: five, statistic: 'Sum' }),
      threshold: 10,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'API returned more than 10 5xx responses in 5 minutes',
    });
    alarm('unhealthy-hosts', {
      metric: props.targetGroup.metrics.unhealthyHostCount({ period: one, statistic: 'Maximum' }),
      threshold: 0,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'At least one API target failing /ready for 3 minutes',
    });
    alarm('p95-latency', {
      metric: props.targetGroup.metrics.targetResponseTime({ period: five, statistic: 'p95' }),
      threshold: m.p95LatencySeconds,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: `API p95 latency above ${m.p95LatencySeconds}s`,
    });

    // ---------- ECS ----------
    for (const [label, svc] of [
      ['api', props.apiService],
      ['worker', props.workerService],
    ] as const) {
      alarm(`${label}-cpu`, {
        metric: svc.metricCpuUtilization({ period: five }),
        threshold: 85,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `${label} CPU above 85%`,
      });
      alarm(`${label}-memory`, {
        metric: svc.metricMemoryUtilization({ period: five }),
        threshold: 85,
        evaluationPeriods: 3,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
        alarmDescription: `${label} memory above 85%`,
      });
    }
    const runningTasks = (serviceName: string) =>
      new cloudwatch.Metric({
        namespace: 'ECS/ContainerInsights',
        metricName: 'RunningTaskCount',
        dimensionsMap: { ClusterName: props.clusterName, ServiceName: serviceName },
        period: one,
        statistic: 'Minimum',
      });
    alarm('worker-not-running', {
      metric: runningTasks(props.workerService.serviceName),
      threshold: 1,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.BREACHING,
      alarmDescription: 'No worker task running for 3 minutes (jobs, outbox relay and reservations stall)',
    });

    // ---------- RDS ----------
    const db = props.db;
    alarm('rds-cpu', {
      metric: db.metricCPUUtilization({ period: five }),
      threshold: 80,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'RDS CPU above 80% for 15 minutes',
    });
    alarm('rds-free-storage', {
      metric: db.metricFreeStorageSpace({ period: five }),
      threshold: m.rdsFreeStorageBytes,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'RDS free storage low (autoscaling may be at max)',
    });
    alarm('rds-connections', {
      metric: db.metricDatabaseConnections({ period: five }),
      threshold: m.rdsMaxConnections,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      alarmDescription: 'RDS connection count high (check Prisma pool size x task count)',
    });
    alarm('rds-freeable-memory', {
      metric: db.metricFreeableMemory({ period: five }),
      threshold: m.rdsFreeableMemoryBytes,
      evaluationPeriods: 3,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      alarmDescription: 'RDS freeable memory low',
    });

    // ---------- SQS ----------
    alarm('jobs-dlq-messages', {
      metric: props.jobsDlq.metricApproximateNumberOfMessagesVisible({ period: one, statistic: 'Maximum' }),
      threshold: 0,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Messages landed in the jobs dead-letter queue',
    });
    alarm('jobs-oldest-message', {
      metric: props.jobsQueue.metricApproximateAgeOfOldestMessage({ period: five, statistic: 'Maximum' }),
      threshold: 900,
      evaluationPeriods: 2,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Oldest job older than 15 minutes (no consumer or consumer failing)',
    });

    // ---------- log metric filters ----------
    // pino JSON: level 50 = error, 60 = fatal.
    const apiErrors = new logs.MetricFilter(this, 'ApiErrorLogs', {
      logGroup: props.apiLogGroup,
      filterPattern: logs.FilterPattern.numberValue('$.level', '>=', 50),
      metricNamespace: n.metricNamespace,
      metricName: 'ApiErrorLogs',
      metricValue: '1',
      defaultValue: 0,
    });
    alarm('api-error-logs', {
      metric: apiErrors.metric({ period: five, statistic: 'Sum' }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: '5+ error-level ("level":50+) API log lines in 5 minutes',
    });
    const workerErrors = new logs.MetricFilter(this, 'WorkerErrorLogs', {
      logGroup: props.workerLogGroup,
      filterPattern: logs.FilterPattern.any(logs.FilterPattern.stringValue('$.msg', '=', 'job loop error'), logs.FilterPattern.numberValue('$.level', '>=', 50)),
      metricNamespace: n.metricNamespace,
      metricName: 'WorkerErrorLogs',
      metricValue: '1',
      defaultValue: 0,
    });
    alarm('worker-error-logs', {
      metric: workerErrors.metric({ period: five, statistic: 'Sum' }),
      threshold: 3,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Worker job loop errors',
    });

    // ---------- dashboard ----------
    const dash = new cloudwatch.Dashboard(this, 'Dashboard', { dashboardName: `${prefix}-overview`, defaultInterval: Duration.hours(6) });
    dash.addWidgets(
      new cloudwatch.TextWidget({ markdown: `# Qitah ${config.envName}\nAlarms notify \`${prefix}-alarms\`. Runbook: docs/aws/DEPLOYMENT.md`, width: 24, height: 2 }),
    );
    dash.addWidgets(
      new cloudwatch.GraphWidget({ title: 'Requests', left: [requests], width: 8 }),
      new cloudwatch.GraphWidget({
        title: '5xx',
        left: [
          alb.httpCodeElb(elbv2.HttpCodeElb.ELB_5XX_COUNT, { period: five, statistic: 'Sum' }),
          alb.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, { period: five, statistic: 'Sum' }),
        ],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Latency p50/p95/p99',
        left: ['p50', 'p95', 'p99'].map((s) => props.targetGroup.metrics.targetResponseTime({ period: five, statistic: s })),
        width: 8,
      }),
    );
    dash.addWidgets(
      new cloudwatch.GraphWidget({
        title: 'ECS CPU / memory',
        left: [props.apiService.metricCpuUtilization(), props.workerService.metricCpuUtilization()],
        right: [props.apiService.metricMemoryUtilization(), props.workerService.metricMemoryUtilization()],
        width: 8,
      }),
      new cloudwatch.GraphWidget({
        title: 'Running tasks',
        left: [runningTasks(props.apiService.serviceName), runningTasks(props.workerService.serviceName)],
        right: [props.targetGroup.metrics.healthyHostCount(), props.targetGroup.metrics.unhealthyHostCount()],
        width: 8,
      }),
      new cloudwatch.GraphWidget({ title: 'Error log lines', left: [apiErrors.metric({ statistic: 'Sum' }), workerErrors.metric({ statistic: 'Sum' })], width: 8 }),
    );
    dash.addWidgets(
      new cloudwatch.GraphWidget({ title: 'RDS CPU / connections', left: [db.metricCPUUtilization()], right: [db.metricDatabaseConnections()], width: 8 }),
      new cloudwatch.GraphWidget({ title: 'RDS storage / memory', left: [db.metricFreeStorageSpace()], right: [db.metricFreeableMemory()], width: 8 }),
      new cloudwatch.GraphWidget({
        title: 'Jobs queue',
        left: [props.jobsQueue.metricApproximateNumberOfMessagesVisible(), props.jobsDlq.metricApproximateNumberOfMessagesVisible()],
        right: [props.jobsQueue.metricApproximateAgeOfOldestMessage()],
        width: 8,
      }),
    );
    dash.addWidgets(new cloudwatch.AlarmStatusWidget({ title: 'Alarms', alarms: this.alarms, width: 24 }));

    // ---------- AWS Budgets (max 5 notifications per budget => separate actual / forecast budgets) ----------
    const costFilters = config.budget.filterByEnvironmentTag ? { TagKeyValue: [`user:Environment$${config.envName}`] } : undefined;
    for (const type of ['ACTUAL', 'FORECASTED'] as const) {
      new budgets.CfnBudget(this, `Budget${type}`, {
        budget: {
          budgetName: `${prefix}-monthly-${type.toLowerCase()}`,
          budgetType: 'COST',
          timeUnit: 'MONTHLY',
          budgetLimit: { amount: config.budget.monthlyUsd, unit: 'USD' },
          costFilters,
        },
        notificationsWithSubscribers: [50, 80, 100].map((threshold) => ({
          notification: { notificationType: type, comparisonOperator: 'GREATER_THAN', threshold, thresholdType: 'PERCENTAGE' },
          subscribers: [{ subscriptionType: 'SNS', address: this.topic.topicArn }],
        })),
      });
    }

    new CfnOutput(this, 'AlarmTopicArn', { value: this.topic.topicArn });
    new CfnOutput(this, 'DashboardName', { value: dash.dashboardName });
  }
}
