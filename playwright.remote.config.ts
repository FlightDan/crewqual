import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e/remote",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/remote-e2e-server.mjs",
    url: "http://127.0.0.1:3000/api/health",
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
