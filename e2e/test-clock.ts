import { test as base, expect, type Page } from "@playwright/test";
import { MOCK_E2E_CLOCK_ISO } from "../src/mocks/test-clock";

/**
 * Install the browser clock only for the local mock suite. Production and
 * remote suites intentionally use their real clock and real services.
 */
export const test = base.extend<{ mockClock: void }>({
  mockClock: [
    async ({ page }, use) => {
      if (
        process.env.PLAYWRIGHT_PRODUCTION !== "1" &&
        process.env.PLAYWRIGHT_USE_TEST_CLOCK === "1"
      ) {
        await page.clock.install({ time: MOCK_E2E_CLOCK_ISO });
        await page.clock.setFixedTime(MOCK_E2E_CLOCK_ISO);
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };
export type { Page };
