import { spawnSync } from "node:child_process";

const runId = Math.random().toString(36).slice(2, 12).toUpperCase();
const employeeNumber = process.env.E2E_PILOT_EMPLOYEE_NUMBER ?? `CQ-E2E-${runId}`;
const credentialNumber =
  process.env.E2E_CREDENTIAL_NUMBER ?? `E2E-CN-${employeeNumber.replace(/^CQ-E2E-/, "")}`;
const env = {
  ...process.env,
  DATABASE_URL:
    process.env.DATABASE_URL ?? "postgresql://crewqual:crewqual@127.0.0.1:55432/crewqual",
  DIRECT_URL: process.env.DIRECT_URL ?? "postgresql://crewqual:crewqual@127.0.0.1:55432/crewqual",
  E2E_PILOT_EMPLOYEE_NUMBER: employeeNumber,
  E2E_CREDENTIAL_NUMBER: credentialNumber,
};

const prepare = spawnSync("corepack", ["pnpm", "db:e2e:prepare"], {
  env,
  stdio: "inherit",
});
if (prepare.status !== 0) process.exit(prepare.status ?? 1);

const recognitionIntegration = spawnSync("corepack", ["pnpm", "test:integration:recognition"], {
  env,
  stdio: "inherit",
});
if (recognitionIntegration.status !== 0) process.exit(recognitionIntegration.status ?? 1);

const e2e = spawnSync(
  "corepack",
  ["pnpm", "exec", "playwright", "test", "--config", "playwright.remote.config.ts"],
  { env, stdio: "inherit" },
);
process.exit(e2e.status ?? 1);
