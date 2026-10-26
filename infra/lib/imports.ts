import { ArnFormat, Stack } from 'aws-cdk-lib';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import type { Construct } from 'constructs';

/**
 * Re-import Data-stack resources in consumer stacks. Grants on IMPORTED resources are written to
 * the consumer's IAM policies (least privilege, scoped ARNs) instead of the Data stack's KMS key /
 * secret policies, which would otherwise reference consumer roles and create a dependency cycle.
 */
export interface DataRefs {
  dataKeyArn: string;
  dbSecretArn: string;
  appSecretArn?: string;
  uploadsBucketName?: string;
  jobsQueueName?: string;
}

export function importData(scope: Construct, refs: DataRefs) {
  const key = kms.Key.fromKeyArn(scope, 'ImportedDataKey', refs.dataKeyArn);
  return {
    key,
    dbSecret: secretsmanager.Secret.fromSecretAttributes(scope, 'ImportedDbSecret', { secretCompleteArn: refs.dbSecretArn, encryptionKey: key }),
    appSecret: refs.appSecretArn
      ? secretsmanager.Secret.fromSecretAttributes(scope, 'ImportedAppSecret', { secretCompleteArn: refs.appSecretArn, encryptionKey: key })
      : undefined,
    uploadsBucket: refs.uploadsBucketName
      ? s3.Bucket.fromBucketAttributes(scope, 'ImportedUploads', { bucketName: refs.uploadsBucketName, encryptionKey: key })
      : undefined,
    jobsQueue: refs.jobsQueueName
      ? sqs.Queue.fromQueueAttributes(scope, 'ImportedJobsQueue', {
          queueArn: Stack.of(scope).formatArn({ service: 'sqs', resource: refs.jobsQueueName, arnFormat: ArnFormat.NO_RESOURCE_NAME }),
          keyArn: refs.dataKeyArn,
        })
      : undefined,
  };
}
