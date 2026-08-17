import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: "list",
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command:
      "NODE_ENV=development SERVICE_MODE=mock NEXT_PUBLIC_SERVICE_MODE=mock CREWQUAL_TEST_NO_EXTERNAL=1 corepack pnpm exec next dev --hostname 127.0.0.1 --port 3000",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: false,
    env: {
      NODE_ENV: "development",
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
