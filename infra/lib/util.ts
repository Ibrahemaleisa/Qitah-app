import { RemovalPolicy } from 'aws-cdk-lib';
import * as logs from 'aws-cdk-lib/aws-logs';

import type { QitahConfig } from '../config';

const VALID_RETENTION = new Set(Object.values(logs.RetentionDays).filter((v): v is number => typeof v === 'number'));

/** Maps a day count to a CloudWatch Logs retention enum value, failing fast on unsupported values. */
export function retention(days: number): logs.RetentionDays {
  if (!VALID_RETENTION.has(days)) {
    throw new Error(`Unsupported CloudWatch Logs retention: ${days} days (use 1,3,5,7,14,30,60,90,120,150,180,365,...)`);
  }
  return days as logs.RetentionDays;
}

/** Production keeps stateful resources on stack deletion; staging cleans up. */
export function statefulRemoval(config: QitahConfig): RemovalPolicy {
  return config.envName === 'production' ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;
}
