/**
 * Typed configuration for one Qitah environment. Every tunable lives here so that staging and
 * production differ only by data (see ./staging.ts and ./production.ts). Account ids are NOT part
 * of the config: they come from CDK context / environment variables (see ./index.ts).
 */
export type EnvName = 'staging' | 'production';

export interface QitahConfig {
  envName: EnvName;
  /** Primary AWS region for the workload. See docs/aws/REGION_DECISION.md. */
  region: string;

  tags: {
    owner: string;
    costCenter: string;
  };

  /** CDK bootstrap qualifier (default `hnb659fds`). Used to scope the GitHub deploy role. */
  cdkQualifier: string;

  network: {
    cidr: string;
    /** Number of AZs. AZ names are `<region>a`, `<region>b`, ... unless availabilityZones is set (no lookups). */
    maxAzs: number;
    availabilityZones?: string[];
    /** 1 = single shared NAT gateway (cheap, staging). maxAzs = one per AZ (HA, production). */
    natGateways: number;
    /** Interface endpoints cost ~USD 7-9/month each per AZ; they pay off once NAT data processing exceeds that. */
    interfaceEndpoints: boolean;
    flowLogRetentionDays: number;
  };

  database: {
    /** e.g. `t4g.micro`. Parsed with ec2.InstanceType. */
    instanceType: string;
    allocatedStorageGiB: number;
    maxAllocatedStorageGiB: number;
    multiAz: boolean;
    backupRetentionDays: number;
    deletionProtection: boolean;
    /** true = snapshot on stack delete/replace (production). false = destroy (staging only). */
    snapshotOnDelete: boolean;
    databaseName: string;
    /** Enable Secrets Manager single-user rotation every N days. Requires a redeploy of ECS after rotation (see DEPLOYMENT.md). */
    rotationDays?: number;
    performanceInsightsRetentionDays: number;
  };

  backup: {
    /** AWS Backup daily plan for RDS in addition to automated backups. */
    enabled: boolean;
    retentionDays: number;
    /** Optional destination vault ARN in another region (cross-region copy). */
    crossRegionCopyVaultArn?: string;
  };

  storage: {
    /** Days after which non-current object versions are expired. */
    noncurrentVersionExpirationDays: number;
    /** Days after which shipping labels (prefix `labels/`) move to Infrequent Access / Glacier IR. */
    labelsTransitionDays: number;
    accessLogRetentionDays: number;
    /** Browser origins allowed to PUT/GET with presigned URLs (portals upload documents directly to S3). */
    uploadCorsOrigins: string[];
  };

  queue: {
    visibilityTimeoutSeconds: number;
    retentionDays: number;
    maxReceiveCount: number;
  };

  auth: {
    /** Pool-level MFA for the staff/merchant pool. Cognito MFA is per pool. */
    staffMfa: 'OPTIONAL' | 'REQUIRED';
    /** Merchants may self-register (still need ops approval in the API). */
    merchantSelfSignUp: boolean;
    /**
     * The API (services/api/src/auth/tokens.ts) currently verifies ONE issuer. Until it supports
     * several pools, choose which pool COGNITO_USER_POOL_ID points at. Both ids are also passed in
     * COGNITO_USER_POOL_IDS for the follow-up change.
     */
    apiPrimaryPool: 'customers' | 'staff';
    /** Destroy pools on stack delete (staging only). */
    removable: boolean;
  };

  compute: {
    cpuArchitecture: 'X86_64' | 'ARM64';
    api: { cpu: number; memoryMiB: number; minTasks: number; maxTasks: number; targetCpuPercent: number; requestsPerTarget: number };
    worker: { cpu: number; memoryMiB: number; desiredTasks: number };
    migration: { cpu: number; memoryMiB: number };
    logRetentionDays: number;
    /** Keep the last N images in ECR (plus untagged cleanup after 7 days). */
    ecrKeepImages: number;
    /** Additional AWS account ids allowed to pull from this ECR repository (staging -> production promotion). */
    ecrPullAccountIds: string[];
    /** Production only: ECR repository ARN to promote images from (staging repo). */
    promoteFromRepositoryArn?: string;
  };

  app: {
    /** NODE_ENV for the API process. The API refuses sandbox providers when `production` unless explicitly allowed. */
    nodeEnv: 'staging' | 'production';
    allowSandboxInProduction: boolean;
    corsOrigins: string[];
    reservationMinutes?: number;
    returnWindowDays?: number;
  };

  edge: {
    /** WAF web ACL on CloudFront (scope CLOUDFRONT, created in us-east-1). Costs ~USD 10+/month. */
    wafEnabled: boolean;
    /** Requests per 5 minutes per IP before the rate rule blocks. */
    rateLimitPer5Min: number;
    priceClass: 'PriceClass_100' | 'PriceClass_200' | 'PriceClass_All';
    /** CloudFront standard access logs to the logs bucket (auto-disabled in regions CloudFront cannot log to). */
    accessLogs: boolean;
    /** Optional custom domain. Domain ownership + certificate validation are external blockers. */
    customDomain?: {
      domainName: string;
      /** ACM certificate in us-east-1 covering domainName (CloudFront requirement). */
      cloudFrontCertificateArn: string;
      /** Optional Route 53 zone to create an alias record in. Imported by attributes (no lookup). */
      hostedZone?: { hostedZoneId: string; zoneName: string };
    };
    /**
     * Optional TLS between CloudFront and the ALB (needs a regional ACM certificate and a DNS name
     * for the ALB, e.g. origin-api.example.sa CNAME -> ALB). Without it the origin hop is HTTP.
     */
    originTls?: { certificateArn: string; originDomainName: string };
  };

  hosting: {
    /** Create the Amplify stack at all. */
    enabled: boolean;
    repositoryUrl: string;
    branch: string;
    /** Secrets Manager secret NAME holding a GitHub token (plain string) for Amplify. External blocker. */
    githubTokenSecretName: string;
    /**
     * Optional basic auth for every branch (staging). Secret NAME holding JSON {"username": "...", "password": "..."}.
     */
    basicAuthSecretName?: string;
    /** Optional IP allow-list (CIDRs) -> WAF web ACL output for manual association with Amplify. */
    ipAllowList?: string[];
  };

  monitoring: {
    alarmEmails: string[];
    /** ALB 5xx as a % of requests that triggers the alarm. */
    alb5xxPercent: number;
    p95LatencySeconds: number;
    rdsFreeStorageBytes: number;
    /** Alarm threshold for RDS DatabaseConnections (not the engine max). */
    rdsMaxConnections: number;
    rdsFreeableMemoryBytes: number;
  };

  budget: {
    monthlyUsd: number;
    /**
     * Filter the budget by the `Environment` cost-allocation tag. Needed only when staging and
     * production share an account (the tag must be activated in Billing first).
     */
    filterByEnvironmentTag: boolean;
  };

  github: {
    /** owner/repo allowed to assume the deploy role. */
    repository: string;
    /** If the account already has the GitHub OIDC provider (e.g. staging+production share an account), import it. */
    existingOidcProviderArn?: string;
    /** Subject claims (after `repo:<repository>:`) allowed to assume the deploy role. */
    allowedSubjects: string[];
  };
}
