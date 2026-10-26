# syntax=docker/dockerfile:1.7
# Qitah API image: one image, three processes (selected by the command):
#   API:        node dist/main.js        (default)
#   worker:     node dist/worker.js
#   migrations: npx prisma migrate deploy
#
# Build:  docker build -t qitah-api services/api
# Run:    docker run --env-file services/api/.env -p 4000:4000 qitah-api

ARG NODE_VERSION=22

# ---------- base: Debian slim + OpenSSL (Prisma query/schema engines link against libssl) ----------
FROM node:${NODE_VERSION}-bookworm-slim AS base
# Unpinned on purpose: always take the current Debian security release of openssl/ca-certificates
# (pinned Debian versions disappear from the archive and break rebuilds). Rebuild regularly.
# hadolint ignore=DL3008
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false \
    NPM_CONFIG_AUDIT=false

# ---------- build: full install, prisma generate, tsc, then prune dev dependencies ----------
FROM base AS build
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npx prisma generate \
 && npm run build \
 && npm prune --omit=dev \
 && npm cache clean --force

# ---------- runtime ----------
FROM base AS runtime
ENV NODE_ENV=production \
    PORT=4000 \
    HOST=0.0.0.0
COPY --from=build --chown=root:root /app/package.json /app/package-lock.json ./
COPY --from=build --chown=root:root /app/node_modules ./node_modules
COPY --from=build --chown=root:root /app/dist ./dist
COPY --from=build --chown=root:root /app/prisma ./prisma
COPY --chown=root:root --chmod=0755 docker/entrypoint.sh /app/docker/entrypoint.sh
COPY --chown=root:root --chmod=0644 docker/compose-database-url.mjs /app/docker/compose-database-url.mjs
# Application files are root-owned and read-only for the runtime user; ECS also mounts the root
# filesystem read-only with a writable /tmp volume.
USER node
EXPOSE 4000
ENTRYPOINT ["/app/docker/entrypoint.sh"]
CMD ["node", "dist/main.js"]
