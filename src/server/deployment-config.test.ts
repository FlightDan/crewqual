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
    expect(installer).toContain("/dev/tty");
    expect(installer).toContain('DEFAULT_INSTALL_DIR="/opt/crewqual"');
    expect(installer).toContain(
      "raw.githubusercontent.com/${GITHUB_REPOSITORY}/${RELEASE_VERSION}",
    );
    expect(installer).toContain("atomic_install");
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
    expect(caddy).toContain("email {$TLS_EMAIL}");
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
