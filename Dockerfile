FROM node:22.12-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates openssl postgresql-client rclone \
  && rm -rf /var/lib/apt/lists/* \
  && npm install --global pnpm@10.15.0
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm db:generate
RUN pnpm build
RUN find .next/standalone -maxdepth 1 -type f -name '.env*' -delete

FROM base AS migration
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/prisma.config.ts ./prisma.config.ts
COPY --from=builder /app/package.json ./package.json
CMD ["pnpm", "db:migrate"]

FROM migration AS bootstrap
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts/bootstrap-production.ts ./scripts/bootstrap-production.ts
COPY --from=builder /app/scripts/migrate-member-architecture.ts ./scripts/migrate-member-architecture.ts
CMD ["pnpm", "db:bootstrap"]

FROM base AS worker-runner
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=builder /app/src/worker ./src/worker
COPY --from=builder /app/src/server ./src/server
COPY --from=builder /app/src/lib ./src/lib
COPY --from=builder /app/src/types ./src/types
COPY --from=builder /app/src/generated ./src/generated
COPY --from=builder /app/scripts/worker-health.mjs ./scripts/worker-health.mjs
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["node", "scripts/worker-health.mjs"]
CMD ["pnpm", "exec", "tsx", "src/worker/index.ts"]

FROM base AS web-runner
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]
CMD ["node", "server.js"]
