import { Stack, Validations } from 'aws-cdk-lib';
import type * as iam from 'aws-cdk-lib/aws-iam';
import type { IConstruct } from 'constructs';

export interface NagAck {
  /** Rule id, optionally with a finding id, e.g. `AwsSolutions-IAM5[Resource::*]`. */
  id: string;
  /** Written justification (shown in the policy-validation report). */
  reason: string;
}

/**
 * Acknowledge cdk-nag findings on one or more constructs (and their children) with a written
 * justification. cdk-nag v3 uses CDK's native `Validations.of().acknowledge()`.
 */
export function acknowledge(scopes: IConstruct | IConstruct[], acks: NagAck[]): void {
  for (const scope of Array.isArray(scopes) ? scopes : [scopes]) {
    if (acks.length) Validations.of(scope).acknowledge(...acks);
  }
}

/**
 * Acknowledge AwsSolutions-IAM5 for every wildcard RESOURCE in the given statements (each finding
 * is listed explicitly, so adding a new wildcard later fails synth until it is justified).
 */
export function acknowledgeWildcardResources(scope: IConstruct, statements: iam.PolicyStatement[], reason: string): void {
  const stack = Stack.of(scope);
  const ids = new Set<string>();
  for (const st of statements) {
    for (const r of st.resources) {
      const resolved = stack.resolve(r);
      if (typeof resolved === 'string' && resolved.includes('*')) ids.add(`AwsSolutions-IAM5[Resource::${resolved}]`);
    }
  }
  acknowledge(scope, [...ids].map((id) => ({ id, reason })));
}
