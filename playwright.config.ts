import { defineConfig, devices } from "@playwright/test";
import { MOCK_E2E_CLOCK_ID } from "./src/mocks/test-clock";

const productionServer = process.env.PLAYWRIGHT_PRODUCTION === "1";
const portValue = process.env.PLAYWRIGHT_PORT ?? "3100";
const port = Number(portValue);
if (!Number.isInteger(port) || port < 1024 || port > 65_535) {
  throw new Error(`PLAYWRIGHT_PORT must be an integer between 1024 and 65535: ${portValue}`);
}

// The mock fixture clock is a runner-level opt-in. The application-side
// module has its own NODE_ENV/service-mode/E2E checks as a second boundary.
process.env.PLAYWRIGHT_USE_TEST_CLOCK = productionServer ? "0" : "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.PLAYWRIGHT_WORKERS
    ? Number.parseInt(process.env.PLAYWRIGHT_WORKERS, 10)
    : process.env.CI
      ? 2
      : 4,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  timeout: 60_000,
  expect: { timeout: 30_000 },
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    locale: "zh-CN",
    navigationTimeout: 60_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  webServer: {
    command: productionServer
      ? `node .next/standalone/server.js`
      : `node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port ${port}`,
    url: `http://127.0.0.1:${port}/api/health?probe=liveness`,
    reuseExistingServer: false,
    env: productionServer
      ? {
          NODE_ENV: "production",
          SERVICE_MODE: "remote",
          NEXT_PUBLIC_SERVICE_MODE: "remote",
          NEXT_PUBLIC_CREWQUAL_E2E: "0",
          NEXT_PUBLIC_CREWQUAL_TEST_CLOCK: "",
          PLAYWRIGHT_USE_TEST_CLOCK: "0",
          CREWQUAL_TEST_NO_EXTERNAL: "1",
          HOSTNAME: "127.0.0.1",
          PORT: String(port),
          APP_ORIGIN: `http://127.0.0.1:${port}`,
          DEPLOYMENT_NETWORK_MODE: "lan",
          DATABASE_URL: "postgresql://crewqual:crewqual@127.0.0.1:1/crewqual",
          DIRECT_URL: "postgresql://crewqual:crewqual@127.0.0.1:1/crewqual",
          SESSION_SECRET: "standalone-smoke-session-secret-0123456789abcdef0123456789",
          SETTINGS_ENCRYPTION_KEY: "standalone-smoke-settings-key-0123456789abcdef",
          READINESS_PROBE_SECRET: "standalone-readiness-probe-secret-0123456789",
          TRUSTED_PROXY_HOPS: "1",
          STORAGE_MODE: "external",
          S3_ENDPOINT: "https://s3.invalid",
          S3_ACCESS_KEY_ID: "standalone-smoke-access-key",
          S3_SECRET_ACCESS_KEY: "standalone-smoke-secret-key",
          OUTBOUND_ALLOWED_HOSTS: "s3.invalid",
        }
      : {
          NODE_ENV: "development",
          SERVICE_MODE: "mock",
          NEXT_PUBLIC_SERVICE_MODE: "mock",
          NEXT_PUBLIC_CREWQUAL_E2E: "1",
          NEXT_PUBLIC_CREWQUAL_TEST_CLOCK: MOCK_E2E_CLOCK_ID,
          CREWQUAL_TEST_NO_EXTERNAL: "1",
          HOSTNAME: "127.0.0.1",
          PORT: String(port),
        },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  testIgnore: ["**/remote/**"],
  testMatch: productionServer ? "**/standalone-smoke.spec.ts" : "**/*.spec.ts",
});
