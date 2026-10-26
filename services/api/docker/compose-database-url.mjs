// Composes a Prisma/PostgreSQL connection string from discrete parts and prints it to stdout.
// Used by docker/entrypoint.sh when DATABASE_URL is not set (AWS: parts come from the RDS-generated
// Secrets Manager secret via ECS secrets). The password and user are URL-encoded.
//
//   DB_HOST (required) DB_PORT=5432 DB_NAME=qitah DB_USER (required) DB_PASSWORD (required)
//   DB_SCHEMA=public  DB_SSLMODE=require (RDS enforces rds.force_ssl=1; use "disable" only locally)
//   DB_CONNECTION_LIMIT (optional, Prisma pool size per process)
//   DB_SSL_ROOT_CERT (optional absolute path to a CA bundle -> sslcert=...&sslaccept=strict)

export function composeDatabaseUrl(env) {
  const missing = ['DB_HOST', 'DB_USER', 'DB_PASSWORD'].filter((k) => !env[k]);
  if (missing.length) throw new Error(`Cannot compose DATABASE_URL: missing ${missing.join(', ')}`);

  const port = env.DB_PORT || '5432';
  if (!/^\d+$/.test(port)) throw new Error('DB_PORT must be numeric');
  const name = env.DB_NAME || 'qitah';
  const params = new URLSearchParams({ schema: env.DB_SCHEMA || 'public', sslmode: env.DB_SSLMODE || 'require' });
  if (env.DB_CONNECTION_LIMIT) params.set('connection_limit', env.DB_CONNECTION_LIMIT);
  if (env.DB_SSL_ROOT_CERT) {
    params.set('sslcert', env.DB_SSL_ROOT_CERT);
    params.set('sslaccept', 'strict');
  }
  const user = encodeURIComponent(env.DB_USER);
  const password = encodeURIComponent(env.DB_PASSWORD);
  return `postgresql://${user}:${password}@${env.DB_HOST}:${port}/${encodeURIComponent(name)}?${params.toString()}`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.stdout.write(composeDatabaseUrl(process.env));
  } catch (err) {
    console.error(JSON.stringify({ level: 60, msg: String(err instanceof Error ? err.message : err) }));
    process.exit(1);
  }
}
