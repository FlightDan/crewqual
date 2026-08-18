import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.RELEASE_BASE_URL;
if (!baseURL) throw new Error("RELEASE_BASE_URL is required for release remote E2E");

export default defineConfig({
  testDir: "./e2e/remote",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["junit", { outputFile: "test-results/release-remote-e2e.xml" }]]
    : "list",
  expect: { timeout: 20_000 },
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
