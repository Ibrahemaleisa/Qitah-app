import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { prisma } from './db.js';

const config = loadConfig();
const app = await buildApp(config);
const close = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGTERM', close);
process.on('SIGINT', close);
await app.listen({ port: config.PORT, host: config.HOST });
