import type { QitahConfig } from './types';

/** Staging: cost-optimised, single NAT, sandbox providers allowed, resources removable. */
export const staging: QitahConfig = {
  envName: 'staging',
  // Interim region while me-central-1 / me-south-1 are impaired and the Saudi region is not yet GA.
  // See docs/aws/REGION_DECISION.md. Override per deploy with `-c region=<code>`.
  region: 'eu-central-1',
  tags: { owner: 'platform@qitah.sa', costCenter: 'qitah-engineering' },
  cdkQualifier: 'hnb659fds',

  network: {
    cidr: '10.20.0.0/16',
    maxAzs: 2,
    natGateways: 1,
    // Interface endpoints (~USD 9/AZ/month each) cost more than NAT processing at staging traffic.
    // The free S3 gateway endpoint still carries ECR image layers.
    interfaceEndpoints: false,
    flowLogRetentionDays: 30,
  },

  database: {
    instanceType: 't4g.micro',
    allocatedStorageGiB: 20,
    maxAllocatedStorageGiB: 100,
    multiAz: false,
    backupRetentionDays: 7,
    deletionProtection: false,
    snapshotOnDelete: false,
    databaseName: 'qitah',
    rotationDays: undefined,
    performanceInsightsRetentionDays: 7,
  },

  backup: { enabled: true, retentionDays: 14 },

  storage: {
    noncurrentVersionExpirationDays: 30,
    labelsTransitionDays: 30,
    accessLogRetentionDays: 90,
    uploadCorsOrigins: ['http://localhost:3000', 'http://localhost:3001', 'https://*.amplifyapp.com'],
  },

  queue: { visibilityTimeoutSeconds: 60, retentionDays: 4, maxReceiveCount: 5 },

  auth: {
    staffMfa: 'OPTIONAL',
    merchantSelfSignUp: true,
    apiPrimaryPool: 'staff',
    removable: true,
  },

  compute: {
    cpuArchitecture: 'X86_64',
    api: { cpu: 512, memoryMiB: 1024, minTasks: 1, maxTasks: 3, targetCpuPercent: 60, requestsPerTarget: 500 },
    worker: { cpu: 256, memoryMiB: 512, desiredTasks: 1 },
    migration: { cpu: 256, memoryMiB: 512 },
    logRetentionDays: 30,
    ecrKeepImages: 30,
    // Put the production account id here (multi-account) so production can promote staging images.
    ecrPullAccountIds: [],
  },

  app: {
    nodeEnv: 'staging',
    allowSandboxInProduction: false,
    corsOrigins: ['http://localhost:8081'],
  },

  edge: {
    wafEnabled: false,
    rateLimitPer5Min: 2000,
    // PriceClass_200 includes Middle East edge locations (PriceClass_100 does not).
    priceClass: 'PriceClass_200',
    accessLogs: true,
  },

  hosting: {
    enabled: true,
    repositoryUrl: 'https://github.com/Ibrahemaleisa/Qitah-app',
    branch: 'main',
    githubTokenSecretName: 'qitah/staging/amplify-github-token',
    basicAuthSecretName: 'qitah/staging/amplify-basic-auth',
  },

  monitoring: {
    alarmEmails: ['alerts-staging@qitah.sa'],
    alb5xxPercent: 5,
    p95LatencySeconds: 2,
    rdsFreeStorageBytes: 2 * 1024 ** 3,
    rdsMaxConnections: 60,
    rdsFreeableMemoryBytes: 100 * 1024 ** 2,
  },

  budget: { monthlyUsd: 250, filterByEnvironmentTag: false },

  github: {
    repository: 'Ibrahemaleisa/Qitah-app',
    allowedSubjects: ['ref:refs/heads/main', 'environment:staging'],
  },
};
