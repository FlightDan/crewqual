import { spawnSync } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";

const runId = Math.random().toString(36).slice(2, 12).toUpperCase();
const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const baseUrl = process.env.RELEASE_BASE_URL ?? `http://127.0.0.1:${port}`;
const baseEnv = {
  ...process.env,
  SERVICE_MODE: "remote",
  NEXT_PUBLIC_SERVICE_MODE: "remote",
  PLAYWRIGHT_PORT: port,
  APP_ORIGIN: process.env.APP_ORIGIN ?? baseUrl,
  RELEASE_BASE_URL: baseUrl,
  SESSION_SECRET:
    process.env.SESSION_SECRET ?? "remote-e2e-only-session-secret-0123456789abcdef0123",
  DEV_ENDPOINTS_SECRET:
    process.env.DEV_ENDPOINTS_SECRET ?? "remote-e2e-dev-endpoint-secret-0123456789",
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://crewqual:crewqual@127.0.0.1:55432/crewqual",
  DIRECT_URL: process.env.DIRECT_URL ?? "postgresql://crewqual:crewqual@127.0.0.1:55432/crewqual",
};
const nextEnvPath = "next-env.d.ts";
const nextEnvOriginal = readFileSync(nextEnvPath);
const tsconfigPath = "tsconfig.json";
const tsconfigOriginal = readFileSync(tsconfigPath);

const recognitionIntegration = spawnSync("corepack", ["pnpm", "test:integration:recognition"], {
  env: baseEnv,
  stdio: "inherit",
});
if (recognitionIntegration.status !== 0) process.exit(recognitionIntegration.status ?? 1);

for (const [browser, suffix] of [
  ["chromium", "CR"],
  ["webkit", "WK"],
  ["firefox", "FF"],
]) {
  const employeeNumber = `CQ-E2E-${runId}-${suffix}`;
  const distDir = `.next-e2e-remote-${runId}-${suffix}`;
  const env = {
    ...baseEnv,
    CREWQUAL_DIST_DIR: distDir,
    E2E_PILOT_EMPLOYEE_NUMBER: employeeNumber,
    E2E_CREDENTIAL_NUMBER: `E2E-CN-${runId}-${suffix}`,
  };
  let exitCode = 0;
  try {
    const prepare = spawnSync("corepack", ["pnpm", "db:e2e:prepare"], {
      env,
      stdio: "inherit",
    });
    if (prepare.status !== 0) {
      exitCode = prepare.status ?? 1;
    } else {
      const e2e = spawnSync(
        "corepack",
        [
          "pnpm",
          "exec",
          "playwright",
          "test",
          "--config",
          "playwright.remote.config.ts",
          `--project=${browser}`,
        ],
        { env, stdio: "inherit" },
      );
      exitCode = e2e.status ?? 1;
    }
  } finally {
    rmSync(distDir, { recursive: true, force: true });
    // Next rewrites this generated reference to the active distDir. Restore
    // the checked-in default after each isolated browser server exits.
    writeFileSync(nextEnvPath, nextEnvOriginal);
    writeFileSync(tsconfigPath, tsconfigOriginal);
  }

  if (exitCode !== 0) process.exit(exitCode);
}
