import * as fs from 'node:fs';
import * as path from 'node:path';

import { App, Stack } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';

import { type EnvName, resolveConfig } from '../config';
import { QitahStage } from '../lib/stage';

export const ACCOUNTS: Record<EnvName, string> = { staging: '111111111111', production: '222222222222' };
export const IMAGE_TAG = '0123456789abcdef0123456789abcdef01234567';

/** Feature flags from cdk.json, so tests synthesize exactly like `cdk synth`. */
export const CDK_JSON_CONTEXT: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'cdk.json'), 'utf8')).context;

const cache = new Map<EnvName, QitahStage>();

/** Builds one environment exactly like bin/qitah.ts does, with dummy accounts and no credentials. */
export function stage(env: EnvName): QitahStage {
  const hit = cache.get(env);
  if (hit) return hit;
  const app = new App({ context: { ...CDK_JSON_CONTEXT, imageTag: IMAGE_TAG } });
  const ctx = (k: string) => app.node.tryGetContext(k);
  const s = new QitahStage(app, `Qitah-${env}`, { config: resolveConfig(env, ctx), account: ACCOUNTS[env], imageTag: IMAGE_TAG });
  cache.set(env, s);
  return s;
}

export function template(stack: Stack): Template {
  return Template.fromStack(stack);
}

export function allStacks(env: EnvName): Stack[] {
  return Object.values(stage(env).stacks).filter((s): s is Stack => s instanceof Stack);
}

export type CfnResource = { Type: string; Properties?: Record<string, unknown>; DeletionPolicy?: string; UpdateReplacePolicy?: string };

export function resources(stack: Stack): Record<string, CfnResource> {
  return template(stack).toJSON().Resources as Record<string, CfnResource>;
}

/** Collects every IAM policy document (inline policies, managed policies, role policies) in a stack. */
export function policyDocuments(stack: Stack): { id: string; doc: { Statement: Array<Record<string, unknown>> } }[] {
  const out: { id: string; doc: { Statement: Array<Record<string, unknown>> } }[] = [];
  for (const [id, r] of Object.entries(resources(stack))) {
    const p = r.Properties ?? {};
    if (r.Type === 'AWS::IAM::Policy' || r.Type === 'AWS::IAM::ManagedPolicy') out.push({ id, doc: p.PolicyDocument as never });
    if (r.Type === 'AWS::IAM::Role') {
      for (const pol of (p.Policies as Array<{ PolicyDocument: never }> | undefined) ?? []) out.push({ id, doc: pol.PolicyDocument });
    }
  }
  return out;
}

export const asArray = <T>(v: T | T[] | undefined): T[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);
