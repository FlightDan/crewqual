import { defineConfig, devices } from "@playwright/test";

const configuredBaseURL = process.env.RELEASE_BASE_URL;
if (!configuredBaseURL) throw new Error("RELEASE_BASE_URL is required for release remote E2E");
const parsedBaseURL = new URL(configuredBaseURL);
if (
  process.env.E2E_CANDIDATE_STACK !== "1" ||
  parsedBaseURL.protocol !== "http:" ||
  parsedBaseURL.hostname !== "127.0.0.1" ||
  parsedBaseURL.username ||
  parsedBaseURL.password ||
  (parsedBaseURL.pathname !== "/" && parsedBaseURL.pathname !== "") ||
  parsedBaseURL.search ||
  parsedBaseURL.hash
) {
  throw new Error("release remote E2E must target the isolated local candidate stack");
}
const baseURL = parsedBaseURL.origin;
for (const name of [
  "E2E_DATABASE_URL",
  "E2E_ADMIN_EMAIL",
  "E2E_ADMIN_PASSWORD",
  "E2E_ADMIN_TOTP_SECRET",
  "E2E_PILOT_EMPLOYEE_NUMBER",
]) {
  if (!process.env[name]?.trim()) throw new Error(`${name} is required for release remote E2E`);
}
if (process.env.E2E_DIRECT_DB_PILOT_TOKEN !== "1") {
  throw new Error("E2E_DIRECT_DB_PILOT_TOKEN=1 is required for release remote E2E");
}

export default defineConfig({
  testDir: "./e2e/remote",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["junit", { outputFile: "test-results/release-remote-e2e.xml" }]]
    : "list",
  expect: { timeout: 20_000 },
  use: {
    baseURL,
    locale: "zh-CN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
  ],
});
