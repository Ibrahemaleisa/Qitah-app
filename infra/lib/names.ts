import type { EnvName } from '../config';

/**
 * Deterministic physical names. The GitHub deploy role is scoped to these names, so it can be
 * deployed first and on its own without cross-stack references.
 */
export function names(env: EnvName) {
  return {
    stagePrefix: `Qitah-${env}`,
    cluster: `qitah-${env}`,
    ecrRepository: `qitah/${env}/api`,
    apiService: `qitah-${env}-api`,
    workerService: `qitah-${env}-worker`,
    migrationFamily: `qitah-${env}-migrate`,
    migrationTaskRole: `qitah-${env}-migrate-task`,
    migrationExecutionRole: `qitah-${env}-migrate-exec`,
    migrationLogGroup: `/qitah/${env}/migrate`,
    apiLogGroup: `/qitah/${env}/api`,
    workerLogGroup: `/qitah/${env}/worker`,
    githubDeployRole: `qitah-${env}-github-deploy`,
    dbSecret: `qitah/${env}/db`,
    appSecret: `qitah/${env}/app`,
    originVerifySecret: `qitah/${env}/origin-verify`,
    metricNamespace: `Qitah/${env}`,
    jobsQueue: `qitah-${env}-jobs`,
    jobsDlq: `qitah-${env}-jobs-dlq`,
  };
}

/** Globally unique, deterministic bucket names (S3 names are global). */
export function bucketNames(env: EnvName, account: string, region: string) {
  return {
    uploads: `qitah-${env}-uploads-${account}-${region}`,
    logs: `qitah-${env}-logs-${account}-${region}`,
  };
}

/** S3 key prefixes the API/worker may read and write (see services/api/src/services/uploads.ts). */
export const UPLOAD_PREFIXES = ['merchants/', 'shipping-labels/'];

/** Header CloudFront adds and the ALB listener rule requires. */
export const ORIGIN_VERIFY_HEADER = 'X-Qitah-Origin-Verify';

/** Port the API container listens on. */
export const API_PORT = 4000;
