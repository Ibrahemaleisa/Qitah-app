#!/bin/sh
# Container entrypoint for the Qitah API image (API, worker and migration task share it).
# If DATABASE_URL is not provided, compose it from DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD
# (injected by ECS from the RDS Secrets Manager secret), URL-encoding the credentials and adding
# sslmode=require. Then exec the command so signals reach the Node process directly.
set -eu

if [ -z "${DATABASE_URL:-}" ] && [ -n "${DB_HOST:-}" ]; then
  DATABASE_URL="$(node /app/docker/compose-database-url.mjs)"
  export DATABASE_URL
fi

# Do not leak the discrete password into child process environments once composed.
unset DB_PASSWORD 2>/dev/null || true

exec "$@"
