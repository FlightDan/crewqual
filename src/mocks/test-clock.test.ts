import { describe, expect, it } from "vitest";
import { getMockNow, isMockE2EClockEnabled, MOCK_E2E_CLOCK_ISO } from "@/mocks/test-clock";

const enabledEnvironment = {
  NODE_ENV: "development",
  SERVICE_MODE: "mock",
  NEXT_PUBLIC_CREWQUAL_E2E: "1",
  NEXT_PUBLIC_CREWQUAL_TEST_CLOCK: "2026-08-14",
};

describe("mock E2E test clock", () => {
  it("enables only for the explicit development mock switch", () => {
    expect(isMockE2EClockEnabled(enabledEnvironment)).toBe(true);
    expect(isMockE2EClockEnabled({ ...enabledEnvironment, NODE_ENV: "production" })).toBe(false);
    expect(isMockE2EClockEnabled({ ...enabledEnvironment, SERVICE_MODE: "remote" })).toBe(false);
    expect(getMockNow(enabledEnvironment).toISOString()).toBe(
      new Date(MOCK_E2E_CLOCK_ISO).toISOString(),
    );
  });
});
