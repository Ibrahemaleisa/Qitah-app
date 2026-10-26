import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as iam from 'aws-cdk-lib/aws-iam';
import type { Construct } from 'constructs';

import type { QitahConfig } from '../../config';
import { names } from '../names';

export interface PlatformStackProps extends StackProps {
  config: QitahConfig;
  vpc: ec2.IVpc;
}

/**
 * ECR repository and ECS cluster. Has no dependency on an image, so CI can deploy it before the
 * first `docker push` (see .github/workflows/deploy-staging.yml).
 */
export class PlatformStack extends Stack {
  readonly repository: ecr.Repository;
  readonly cluster: ecs.Cluster;

  constructor(scope: Construct, id: string, props: PlatformStackProps) {
    super(scope, id, props);
    const { config, vpc } = props;
    const n = names(config.envName);
    const prod = config.envName === 'production';

    this.repository = new ecr.Repository(this, 'ApiRepository', {
      repositoryName: n.ecrRepository,
      imageScanOnPush: true,
      imageTagMutability: ecr.TagMutability.IMMUTABLE,
      encryption: ecr.RepositoryEncryption.AES_256,
      removalPolicy: prod ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY,
      emptyOnDelete: !prod,
      lifecycleRules: [
        { rulePriority: 1, description: 'Expire untagged images after 7 days', tagStatus: ecr.TagStatus.UNTAGGED, maxImageAge: Duration.days(7) },
        { rulePriority: 2, description: `Keep the last ${config.compute.ecrKeepImages} images`, tagStatus: ecr.TagStatus.ANY, maxImageCount: config.compute.ecrKeepImages },
      ],
    });
    if (config.compute.ecrPullAccountIds.length) {
      this.repository.addToResourcePolicy(
        new iam.PolicyStatement({
          sid: 'PromotionPull',
          principals: config.compute.ecrPullAccountIds.map((a) => new iam.AccountPrincipal(a)),
          actions: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability', 'ecr:DescribeImages'],
        }),
      );
    }

    this.cluster = new ecs.Cluster(this, 'Cluster', {
      clusterName: n.cluster,
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    new CfnOutput(this, 'RepositoryUri', { value: this.repository.repositoryUri });
    new CfnOutput(this, 'RepositoryName', { value: this.repository.repositoryName });
    new CfnOutput(this, 'ClusterName', { value: this.cluster.clusterName });
  }
}
