import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compose = readFileSync(path.resolve(process.cwd(), "docker-compose.yml"), "utf8");
const releaseCompose = readFileSync(
  path.resolve(process.cwd(), "docker-compose.release.yml"),
  "utf8",
);
const installCompose = readFileSync(
  path.resolve(process.cwd(), "docker-compose.install.yml"),
  "utf8",
);
const releaseWorkflow = readFileSync(
  path.resolve(process.cwd(), ".github/workflows/release-acceptance.yml"),
  "utf8",
);
const caddy = readFileSync(path.resolve(process.cwd(), "Caddyfile"), "utf8");
const dockerfile = readFileSync(path.resolve(process.cwd(), "Dockerfile"), "utf8");
const installer = readFileSync(path.resolve(process.cwd(), "install.sh"), "utf8");
const runtimeRoleScript = readFileSync(
  path.resolve(process.cwd(), "scripts/ensure-postgres-runtime-role.sh"),
  "utf8",
);
const containerEntrypoint = readFileSync(
  path.resolve(process.cwd(), "scripts/container-entrypoint.mjs"),
  "utf8",
);
const jobsSource = readFileSync(path.resolve(process.cwd(), "src/server/jobs.ts"), "utf8");
const psqlUrlWrapper = readFileSync(
  path.resolve(process.cwd(), "scripts/psql-from-url.ts"),
  "utf8",
);
const postgresClientEnvironment = readFileSync(
  path.resolve(process.cwd(), "src/server/postgres-client-environment.ts"),
  "utf8",
);
const auditIntegrityMigration = readFileSync(
  path.resolve(
    process.cwd(),
    "prisma/migrations/20260904010000_database_roles_audit_integrity/migration.sql",
  ),
  "utf8",
);

describe("deployment configuration", () => {
  it("declares isolated application, worker, database, queue and object-storage services", () => {
    expect(compose).toMatch(/services:\s+postgres:/);
    expect(compose).toMatch(/\n  web:/);
    expect(compose).toMatch(/\n  worker:/);
    expect(compose).toMatch(/\n  migrate:/);
    expect(compose).toMatch(/\n  bootstrap:/);
    expect(compose).toMatch(/\n  caddy:/);
    expect(compose).toMatch(/\n  minio:/);
    expect(compose).toMatch(/\n  minio-init:/);
    for (const text of [compose, releaseCompose, installCompose]) {
      expect(text).toMatch(/minio-init:\s*\n\s+image: minio\/mc@sha256:[0-9a-f]{64}/);
    }
    expect(compose).toMatch(/networks:\s+\[internal\]/);
    expect(compose).toMatch(/driver: bridge/);
    expect(compose).toMatch(/pg_isready -U crewqual -d crewqual/);
    expect(compose).toMatch(/condition: service_healthy/);
    expect(compose).toMatch(/condition: service_completed_successfully/);
    expect(compose).toContain("target: web-runner");
    expect(compose.match(/target: runtime-runner/g)).toHaveLength(4);
    expect(compose).not.toContain("target: worker-runner");
    expect(compose).not.toContain("target: ops-runner");
    expect(dockerfile).toContain('CMD ["node", "--import", "tsx", "src/worker/index.ts"]');
    expect(dockerfile).toContain("FROM node:22.12-bookworm-slim AS web-runtime");
    expect(dockerfile).toContain("FROM node:22.12-bookworm-slim AS data-runtime");
    expect(dockerfile).toContain("FROM data-runtime AS runtime-runner");
    expect(dockerfile).not.toContain("FROM base AS web-runner");
    expect(dockerfile).not.toContain("worker-runner");
    expect(dockerfile).not.toContain("ops-runner");
    expect(dockerfile).not.toContain(
      'HEALTHCHECK --interval=15s --timeout=5s --retries=3 CMD ["node", "scripts/worker-health.mjs"]',
    );
    expect(compose).toContain('command: ["node", "scripts/container-entrypoint.mjs", "migrate"]');
    expect(compose).toContain('command: ["node", "scripts/container-entrypoint.mjs", "bootstrap"]');
    expect(compose).toContain('command: ["node", "scripts/container-entrypoint.mjs", "db-check"]');
    expect(dockerfile).toContain("grep -E ' 16\\.'");
    expect(compose).toContain("scripts/worker-health.mjs");
    expect(compose).toContain(
      "POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}",
    );
    expect(compose).not.toContain("postgresql://crewqual:crewqual@");
    expect(compose).not.toMatch(/image: .*:latest/);
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("backup-data:/backups");
  });

  it("uses one immutable Runtime image for release jobs and Worker", () => {
    expect(releaseCompose).toContain("RELEASE_RUNTIME_IMAGE");
    expect(releaseCompose).not.toContain("RELEASE_WORKER_IMAGE");
    expect(releaseCompose).not.toContain("RELEASE_OPS_IMAGE");
    expect(releaseCompose).toContain('test: ["CMD", "node", "scripts/worker-health.mjs"]');
    expect(releaseWorkflow).toContain("RELEASE_RUNTIME_IMAGE");
    expect(releaseWorkflow).not.toContain("RELEASE_WORKER_IMAGE");
    expect(releaseWorkflow).not.toContain("RELEASE_OPS_IMAGE");
  });

  it("keeps readiness private while wiring authenticated container probes", () => {
    for (const text of [compose, releaseCompose, installCompose]) {
      expect(text).toContain(
        "READINESS_PROBE_SECRET: ${READINESS_PROBE_SECRET:?READINESS_PROBE_SECRET is required}",
      );
    }
    for (const text of [compose, installCompose, dockerfile]) {
      expect(text).toContain("x-crewqual-readiness-secret");
      expect(text).toContain("process.env.READINESS_PROBE_SECRET");
    }
    expect(installer).toContain('readiness_probe_secret="$(openssl rand -hex 32)"');
    expect(installer).toContain("READINESS_PROBE_SECRET='%s'");
  });

  it("keeps the owner database credential out of runtime services and makes audit rows append-only", () => {
    for (const text of [compose, releaseCompose, installCompose]) {
      expect(text.match(/^\s+DIRECT_URL:/gm)).toHaveLength(1);
      expect(text.match(/^\s+POSTGRES_APP_PASSWORD:/gm)).toHaveLength(1);
      expect(text).toContain('command: ["node", "scripts/container-entrypoint.mjs", "migrate"]');
    }
    expect(installer).toContain("DATABASE_URL='postgresql://crewqual_app:");
    expect(installer).toContain("DIRECT_URL='postgresql://crewqual:");
    expect(runtimeRoleScript).toContain("psql-from-url.ts DIRECT_URL --no-psqlrc");
    expect(runtimeRoleScript).toContain("psql-from-url.ts DATABASE_URL --no-psqlrc");
    expect(runtimeRoleScript).not.toContain('psql "$DIRECT_URL"');
    expect(runtimeRoleScript).not.toContain("--set=app_password");
    expect(runtimeRoleScript).toContain("\\getenv app_password POSTGRES_APP_PASSWORD");
    expect(runtimeRoleScript).toContain("pg_catalog.pg_auth_members");
    expect(runtimeRoleScript).toContain("REVOKE %I FROM %I");
    expect(runtimeRoleScript).toContain("ALL TABLES IN SCHEMA pgboss FROM PUBLIC, crewqual_app");
    expect(runtimeRoleScript).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO crewqual_app",
    );
    expect(runtimeRoleScript).toContain(
      "GRANT EXECUTE ON FUNCTION pgboss.create_queue(text, jsonb) TO crewqual_app",
    );
    expect(runtimeRoleScript).toContain(
      "procedure.oid <> 'pgboss.create_queue(text,jsonb)'::regprocedure",
    );
    expect(containerEntrypoint).toContain("scripts/migrate-pg-boss.ts");
    expect(containerEntrypoint.indexOf("scripts/migrate-pg-boss.ts")).toBeLessThan(
      containerEntrypoint.indexOf('ensure-postgres-runtime-role.sh", "grant'),
    );
    expect(jobsSource).toContain("migrate: false");
    expect(jobsSource).not.toContain("migrate: true");
    expect(psqlUrlWrapper).toContain('spawnSync("psql", psqlArguments');
    expect(psqlUrlWrapper).toContain("minimalSubprocessEnvironment");
    expect(postgresClientEnvironment).toContain("delete environment.DIRECT_URL");
    expect(postgresClientEnvironment).not.toContain("...process.env");
    expect(auditIntegrityMigration).toContain('GRANT SELECT, INSERT ON TABLE "AuditEvent"');
    expect(auditIntegrityMigration).toContain('BEFORE TRUNCATE ON "AuditEvent"');
    expect(auditIntegrityMigration).toContain("REVOKE CREATE ON SCHEMA public");
    expect(auditIntegrityMigration).toContain("REVOKE CREATE, TEMP ON DATABASE %I FROM PUBLIC, %I");
  });

  it("ships the public installer with one Web and one shared Runtime image", () => {
    expect(installCompose).toContain("name: crewqual");
    expect(installCompose).toContain(
      "image: ${CREWQUAL_WEB_IMAGE:?CREWQUAL_WEB_IMAGE is required}",
    );
    expect(installCompose).toContain(
      "image: ${CREWQUAL_RUNTIME_IMAGE:?CREWQUAL_RUNTIME_IMAGE is required}",
    );
    expect(installCompose).toContain("CREWQUAL_WEB_IMAGE: ${CREWQUAL_WEB_IMAGE");
    expect(installCompose).toContain("CREWQUAL_RUNTIME_IMAGE: ${CREWQUAL_RUNTIME_IMAGE");
    expect(installCompose).not.toContain("build:");
    expect(installCompose).toContain("minio-data:/data");
    expect(installCompose).toContain('"${APP_BIND:-0.0.0.0}:${APP_PORT:-443}:${APP_PORT:-443}"');
    expect(installCompose).toContain('"${ACME_BIND:-127.0.0.1}:${ACME_PORT:-18080}:80"');
    expect(installCompose).not.toMatch(/5432:5432|9000:9000|3000:3000/);
  });

  it("keeps the public installer versioned, pipe-safe, and volume-preserving", () => {
    expect(installer).toContain("/releases/latest");
    expect(installer).toContain("--channel CHANNEL");
    expect(installer).toContain("/dev/tty");
    expect(installer).toContain('DEFAULT_INSTALL_DIR="/opt/crewqual"');
    expect(installer).toContain(
      "https://github.com/${GITHUB_REPOSITORY}/releases/download/${RELEASE_VERSION}",
    );
    expect(installer).toContain("atomic_install");
    expect(installer).toContain("是否仅允许局域网访问？[Y/n]");
    expect(installer).toContain("--public-address HOST");
    expect(installer).toContain('NETWORK_MODE_INPUT="http"');
    expect(installer).toContain("public_http_warning");
    expect(installer).not.toMatch(/^\s*(compose|docker compose)\s+down\s+-v/m);
    expect(installer).not.toMatch(/^\s*docker\s+volume\s+(rm|prune)/m);
  });

  it("keeps local development storage optional and external notifications disabled by default", () => {
    expect(compose).toMatch(/profiles: \[dev\]/);
    expect(compose).toMatch(/SMS_ADAPTER: \$\{SMS_ADAPTER:-disabled\}/);
    expect(compose).toMatch(/FEISHU_ADAPTER: \$\{FEISHU_ADAPTER:-disabled\}/);
    expect(compose).toMatch(/VLM_ADAPTER: \$\{VLM_ADAPTER:-disabled\}/);
    expect(compose).not.toMatch(/https?:\/\/(?!postgres|web|minio|localhost|127\.0\.0\.1)/);
  });

  it("routes through Caddy with TLS and baseline browser security headers", () => {
    expect(caddy).toContain("{$CADDY_EMAIL_CONFIG}");
    expect(caddy).toContain("{$CADDY_SITE_ADDRESS} {");
    expect(caddy).toContain("forward_auth @public web:3000");
    expect(caddy).toContain("@public not remote_ip private_ranges");
    expect(caddy).toContain("handle /api/internal/network-access");
    expect(caddy).toContain("X-Crewqual-Network-Secret {$NETWORK_ACCESS_SECRET}");
    expect(caddy).toContain("reverse_proxy web:3000");
    expect(caddy).toContain('Strict-Transport-Security "max-age=31536000; includeSubDomains"');
    expect(caddy).toContain('X-Content-Type-Options "nosniff"');
    expect(caddy).toContain('X-Frame-Options "DENY"');
    expect(caddy).toContain('Referrer-Policy "same-origin"');
    expect(caddy).toContain('Permissions-Policy "camera=(), microphone=()"');
    expect(caddy).toContain("max_size 12MB");
    expect(caddy).toContain("-Server");
    expect(caddy).toContain('X-Robots-Tag "noindex, nofollow"');
  });

  it("defaults the development/mock launcher to all interfaces", () => {
    const launcher = readFileSync(path.resolve(process.cwd(), "run_webui.sh"), "utf8");
    const windowsLauncher = readFileSync(path.resolve(process.cwd(), "run_webui.bat"), "utf8");
    expect(launcher).toContain("WEBUI_HOST=${WEBUI_HOST:-0.0.0.0}");
    expect(launcher).toContain("ensure_supported_bind");
    expect(launcher).toContain("0.0.0.0|127.0.0.1|localhost|::1");
    expect(windowsLauncher).toContain('set "WEBUI_HOST=0.0.0.0"');
    expect(windowsLauncher).toContain(":ensure_supported_bind");
    expect(windowsLauncher).toContain(":wait_for_webui_ready");
    expect(windowsLauncher).toContain("Get-Process -Id");
    expect(windowsLauncher).toContain("webui.previous.log");
  });
});
