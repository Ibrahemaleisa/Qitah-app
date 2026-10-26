import { SQSClient } from '@aws-sdk/client-sqs';

import { loadConfig } from './config.js';
import { createContext } from './context.js';
import { prisma } from './db.js';
import { runAllJobs } from './jobs.js';

const config = loadConfig();
const ctx = createContext(config);
const sqs = config.JOBS_QUEUE_URL ? { client: new SQSClient({ region: config.AWS_REGION }), queueUrl: config.JOBS_QUEUE_URL } : undefined;
let stopping = false;
process.on('SIGTERM', () => (stopping = true));
process.on('SIGINT', () => (stopping = true));

console.log(JSON.stringify({ msg: 'qitah worker started', sqs: Boolean(sqs), sandbox: config.sandbox }));
while (!stopping) {
  try {
    const r = await runAllJobs(ctx, { sqs });
    if (Object.values(r).some((n) => n > 0)) console.log(JSON.stringify({ msg: 'jobs', ...r }));
  } catch (e) {
    console.error(JSON.stringify({ msg: 'job loop error', error: String(e) }));
  }
  await new Promise((r) => setTimeout(r, 5000));
}
await prisma.$disconnect();
