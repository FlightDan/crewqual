import { defineConfig, devices } from "@playwright/test";

const port = process.env.PLAYWRIGHT_PORT ?? "3000";
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e/remote",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    locale: "zh-CN",
    trace: "on-first-retry",
  },
  webServer: {
    command: "node scripts/remote-e2e-server.mjs",
    url: `${baseURL}/api/health?probe=liveness`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
