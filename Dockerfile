FROM node:22.12-bookworm-slim AS build-base
ARG VCS_REF=unknown
ARG VERSION=unknown
ARG SOURCE_URL=https://example.invalid/crewqual
LABEL org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.source="$SOURCE_URL"
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@10.15.0
WORKDIR /app

FROM build-base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY runtime/package.json runtime/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm check:runtime-deps
RUN pnpm db:generate
RUN pnpm build
RUN find .next/standalone -maxdepth 1 -type f -name '.env*' -delete

FROM build-base AS runtime-deps
WORKDIR /runtime
COPY runtime/package.json runtime/pnpm-lock.yaml ./
RUN pnpm --config.auto-install-peers=false install --prod --frozen-lockfile

FROM node:22.12-bookworm-slim AS web-runtime
ARG VCS_REF=unknown
ARG VERSION=unknown
ARG SOURCE_URL=https://example.invalid/crewqual
LABEL org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.source="$SOURCE_URL"
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/*
WORKDIR /app

FROM node:22.12-bookworm-slim AS data-runtime
ARG VCS_REF=unknown
ARG VERSION=unknown
ARG SOURCE_URL=https://example.invalid/crewqual
LABEL org.opencontainers.image.revision="$VCS_REF" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.source="$SOURCE_URL"
RUN apt-get update \
  && apt-get upgrade -y \
  && apt-get install -y --no-install-recommends ca-certificates wget gnupg rclone \
  && install -d /usr/share/postgresql-common/pgdg \
  && wget -qO- https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-16 \
  && apt-get purge -y --auto-remove wget gnupg gnupg-utils dirmngr \
  && rm -rf /var/lib/apt/lists/* /var/cache/apt/* \
  && pg_dump --version | grep -E ' 16\.' \
  && install -d -o node -g node /backups \
  && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
WORKDIR /app

FROM data-runtime AS runtime-runner
ENV NODE_ENV=production
COPY --chown=node:node --from=runtime-deps /runtime/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --chown=node:node --from=builder /app/package.json ./package.json
COPY --chown=node:node --from=builder /app/scripts/container-entrypoint.mjs ./scripts/container-entrypoint.mjs
COPY --chown=node:node --from=builder /app/tsconfig.json ./tsconfig.json
COPY --chown=node:node --from=builder /app/src ./src
COPY --chown=node:node --from=builder /app/scripts ./scripts
COPY --chown=node:node --from=builder /app/tsconfig.scripts.json ./tsconfig.scripts.json
USER node
CMD ["node", "--import", "tsx", "src/worker/index.ts"]

FROM web-runtime AS web-runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
COPY --chown=node:node --from=builder /app/.next/standalone ./
COPY --chown=node:node --from=builder /app/.next/static ./.next/static
COPY --chown=node:node --from=builder /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
USER node
CMD ["node", "server.js"]
