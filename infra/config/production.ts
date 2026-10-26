import type { QitahConfig } from './types';

/** Production: highly available, retained data, WAF on, stricter auth and alarms. */
export const production: QitahConfig = {
  envName: 'production',
  // Interim launch region. Re-evaluate when the AWS Saudi Arabia region is GA (expected Dec 2026)
  // and the services in docs/aws/REGION_DECISION.md are confirmed there. Override with `-c region=`.
  region: 'eu-central-1',
  tags: { owner: 'platform@qitah.sa', costCenter: 'qitah-production' },
  cdkQualifier: 'hnb659fds',

  network: {
    cidr: '10.30.0.0/16',
    maxAzs: 2,
    natGateways: 2,
    interfaceEndpoints: true,
    flowLogRetentionDays: 90,
  },

  database: {
    instanceType: 't4g.medium',
    allocatedStorageGiB: 50,
    maxAllocatedStorageGiB: 500,
    multiAz: true,
    backupRetentionDays: 30,
    deletionProtection: true,
    snapshotOnDelete: true,
    databaseName: 'qitah',
    rotationDays: undefined,
    performanceInsightsRetentionDays: 7,
  },

  backup: { enabled: true, retentionDays: 35, crossRegionCopyVaultArn: undefined },

  storage: {
    noncurrentVersionExpirationDays: 90,
    labelsTransitionDays: 30,
    accessLogRetentionDays: 365,
    // Replace with the portals' custom domains once they exist.
    uploadCorsOrigins: ['https://merchant.qitah.sa', 'https://ops.qitah.sa', 'https://*.amplifyapp.com'],
  },

  queue: { visibilityTimeoutSeconds: 60, retentionDays: 14, maxReceiveCount: 5 },

  auth: {
    staffMfa: 'REQUIRED',
    merchantSelfSignUp: true,
    apiPrimaryPool: 'staff',
    removable: false,
  },

  compute: {
    cpuArchitecture: 'X86_64',
    api: { cpu: 1024, memoryMiB: 2048, minTasks: 2, maxTasks: 10, targetCpuPercent: 55, requestsPerTarget: 800 },
    worker: { cpu: 512, memoryMiB: 1024, desiredTasks: 1 },
    migration: { cpu: 512, memoryMiB: 1024 },
    logRetentionDays: 90,
    ecrKeepImages: 100,
    ecrPullAccountIds: [],
    // Set to the staging repository ARN, e.g.
    // 'arn:aws:ecr:eu-central-1:<staging-account>:repository/qitah/staging/api'
    promoteFromRepositoryArn: undefined,
  },

  app: {
    nodeEnv: 'production',
    // The API refuses to boot with sandbox payment/carrier providers in production. Keep false until
    // real providers are integrated (production-readiness gate). Flip only for a closed pilot.
    allowSandboxInProduction: false,
    corsOrigins: [],
  },

  edge: {
    wafEnabled: true,
    rateLimitPer5Min: 2000,
    // PriceClass_200 includes Middle East edge locations (PriceClass_100 does not).
    priceClass: 'PriceClass_200',
    accessLogs: true,
  },

  hosting: {
    enabled: true,
    repositoryUrl: 'https://github.com/Ibrahemaleisa/Qitah-app',
    branch: 'production',
    githubTokenSecretName: 'qitah/production/amplify-github-token',
  },

  monitoring: {
    alarmEmails: ['alerts@qitah.sa'],
    alb5xxPercent: 1,
    p95LatencySeconds: 1,
    rdsFreeStorageBytes: 10 * 1024 ** 3,
    rdsMaxConnections: 300,
    rdsFreeableMemoryBytes: 400 * 1024 ** 2,
  },

  budget: { monthlyUsd: 900, filterByEnvironmentTag: false },

  github: {
    repository: 'Ibrahemaleisa/Qitah-app',
    allowedSubjects: ['environment:production'],
  },
};
