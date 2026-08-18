import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const compose = readFileSync(path.resolve(process.cwd(), "docker-compose.yml"), "utf8");
const caddy = readFileSync(path.resolve(process.cwd(), "Caddyfile"), "utf8");
const dockerfile = readFileSync(path.resolve(process.cwd(), "Dockerfile"), "utf8");

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
    expect(compose).toContain("target: worker-runner");
    expect(compose).toContain("target: bootstrap");
    expect(dockerfile).toContain('CMD ["pnpm", "db:bootstrap"]');
    expect(compose).toContain("scripts/worker-health.mjs");
    expect(compose).toContain(
      "POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}",
    );
    expect(compose).not.toContain("postgresql://crewqual:crewqual@");
    expect(compose).not.toMatch(/image: .*:latest/);
    expect(compose).toContain("restart: unless-stopped");
    expect(compose).toContain("backup-data:/backups");
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
    expect(caddy).toContain("{$APP_DOMAIN} {");
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
