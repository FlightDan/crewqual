import { defineConfig, devices } from "@playwright/test";

const productionServer = process.env.PLAYWRIGHT_PRODUCTION === "1";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: "list",
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    locale: "zh-CN",
    trace: "on-first-retry",
  },
  webServer: {
    command: productionServer
      ? "NODE_ENV=production SERVICE_MODE=mock NEXT_PUBLIC_SERVICE_MODE=mock CREWQUAL_TEST_NO_EXTERNAL=1 node node_modules/next/dist/bin/next start --hostname 127.0.0.1 --port 3000"
      : "NODE_ENV=development SERVICE_MODE=mock NEXT_PUBLIC_SERVICE_MODE=mock CREWQUAL_TEST_NO_EXTERNAL=1 node node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    env: {
      NODE_ENV: productionServer ? "production" : "development",
      SERVICE_MODE: "mock",
      NEXT_PUBLIC_SERVICE_MODE: "mock",
      CREWQUAL_TEST_NO_EXTERNAL: "1",
    },
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
  testIgnore: ["**/remote/**"],
});
