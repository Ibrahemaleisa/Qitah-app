import { ArnFormat, CfnOutput, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { retention } from '../util';

export interface EdgeStackProps extends StackProps {
  config: QitahConfig;
}

function managedRule(name: string, priority: number, overrides: string[] = []): wafv2.CfnWebACL.RuleProperty {
  return {
    name,
    priority,
    overrideAction: { none: {} },
    statement: {
      managedRuleGroupStatement: {
        vendorName: 'AWS',
        name,
        ruleActionOverrides: overrides.length ? overrides.map((r) => ({ name: r, actionToUse: { count: {} } })) : undefined,
      },
    },
    visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: name, sampledRequestsEnabled: true },
  };
}

/**
 * Resources that must live in us-east-1 because CloudFront is global: the WAF web ACL for the API
 * distribution (toggle: edge.wafEnabled) and an optional IP allow-list ACL for the Amplify portals.
 */
export class EdgeStack extends Stack {
  readonly apiWebAclArn?: string;
  readonly portalAllowListAclArn?: string;

  constructor(scope: Construct, id: string, props: EdgeStackProps) {
    super(scope, id, props);
    const { config } = props;
    const prefix = `qitah-${config.envName}`;

    if (config.edge.wafEnabled) {
      const acl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
        name: `${prefix}-api`,
        scope: 'CLOUDFRONT',
        defaultAction: { allow: {} },
        visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `${prefix}-api`, sampledRequestsEnabled: true },
        rules: [
          {
            name: 'rate-limit-per-ip',
            priority: 0,
            action: { block: {} },
            statement: { rateBasedStatement: { limit: config.edge.rateLimitPer5Min, aggregateKeyType: 'IP' } },
            visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'rate-limit-per-ip', sampledRequestsEnabled: true },
          },
          managedRule('AWSManagedRulesAmazonIpReputationList', 1),
          // Request bodies up to 2 MiB are legitimate (API bodyLimit), so the 8 KB body-size rule only counts.
          managedRule('AWSManagedRulesCommonRuleSet', 2, ['SizeRestrictions_BODY']),
          managedRule('AWSManagedRulesKnownBadInputsRuleSet', 3),
        ],
      });
      this.apiWebAclArn = acl.attrArn;

      // WAF requires the log group name to start with aws-waf-logs-.
      const wafLogs = new logs.LogGroup(this, 'WafLogs', {
        logGroupName: `aws-waf-logs-${prefix}-api`,
        retention: retention(config.compute.logRetentionDays),
        removalPolicy: RemovalPolicy.DESTROY,
      });
      new wafv2.CfnLoggingConfiguration(this, 'WafLogging', {
        resourceArn: acl.attrArn,
        // WAF needs the log-group ARN WITHOUT the trailing ":*" that LogGroup.logGroupArn carries.
        logDestinationConfigs: [
          this.formatArn({ service: 'logs', resource: 'log-group', resourceName: wafLogs.logGroupName, arnFormat: ArnFormat.COLON_RESOURCE_NAME }),
        ],
        redactedFields: [{ singleHeader: { Name: 'authorization' } }, { singleHeader: { Name: 'cookie' } }],
      });
      new CfnOutput(this, 'ApiWebAclArn', { value: acl.attrArn });
    }

    const allowList = config.hosting.ipAllowList ?? [];
    if (allowList.length) {
      const ipSet = new wafv2.CfnIPSet(this, 'PortalAllowList', {
        name: `${prefix}-portal-allow`,
        scope: 'CLOUDFRONT',
        ipAddressVersion: 'IPV4',
        addresses: allowList,
      });
      const acl = new wafv2.CfnWebACL(this, 'PortalWebAcl', {
        name: `${prefix}-portals`,
        scope: 'CLOUDFRONT',
        defaultAction: { block: {} },
        visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: `${prefix}-portals`, sampledRequestsEnabled: true },
        rules: [
          {
            name: 'allow-listed-ips',
            priority: 0,
            action: { allow: {} },
            statement: { ipSetReferenceStatement: { arn: ipSet.attrArn } },
            visibilityConfig: { cloudWatchMetricsEnabled: true, metricName: 'allow-listed-ips', sampledRequestsEnabled: true },
          },
        ],
      });
      this.portalAllowListAclArn = acl.attrArn;
      // Associate with the Amplify app in the Amplify console (Hosting > Firewall). See DEPLOYMENT.md.
      new CfnOutput(this, 'PortalWebAclArn', { value: acl.attrArn });
    }
  }
}
