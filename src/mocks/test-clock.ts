import type { Clock } from "@/types/services";

/**
 * The mock UI uses a stable business date during browser E2E. The opt-in is
 * deliberately expressed with public E2E variables because the same fixture
 * module is evaluated by Next on both sides of the client/server boundary.
 * Production can never enable this clock: the NODE_ENV guard is part of the
 * decision and is also inlined by Next for client bundles.
 */
export const MOCK_E2E_CLOCK_ID = "2026-08-14";
export const MOCK_E2E_CLOCK_ISO = "2026-08-14T12:00:00.000+08:00";

type ClockEnvironment = {
  NODE_ENV?: string;
  SERVICE_MODE?: string;
  NEXT_PUBLIC_SERVICE_MODE?: string;
  NEXT_PUBLIC_CREWQUAL_E2E?: string;
  NEXT_PUBLIC_CREWQUAL_TEST_CLOCK?: string;
};

// Keep public lookups as direct process.env accesses so Next inlines them in
// the client bundle. Server-only SERVICE_MODE remains available at runtime.
const compiledEnvironment: ClockEnvironment = {
  NODE_ENV: process.env.NODE_ENV,
  SERVICE_MODE: process.env.SERVICE_MODE,
  NEXT_PUBLIC_SERVICE_MODE: process.env.NEXT_PUBLIC_SERVICE_MODE,
  NEXT_PUBLIC_CREWQUAL_E2E: process.env.NEXT_PUBLIC_CREWQUAL_E2E,
  NEXT_PUBLIC_CREWQUAL_TEST_CLOCK: process.env.NEXT_PUBLIC_CREWQUAL_TEST_CLOCK,
};

function runtimeEnvironment(): ClockEnvironment {
  return compiledEnvironment;
}

export function isMockE2EClockEnabled(
  environment: ClockEnvironment = runtimeEnvironment(),
): boolean {
  const serviceMode = environment.SERVICE_MODE ?? environment.NEXT_PUBLIC_SERVICE_MODE;
  return (
    environment.NODE_ENV !== "production" &&
    serviceMode === "mock" &&
    environment.NEXT_PUBLIC_CREWQUAL_E2E === "1" &&
    environment.NEXT_PUBLIC_CREWQUAL_TEST_CLOCK === MOCK_E2E_CLOCK_ID
  );
}

export function getMockNow(environment: ClockEnvironment = runtimeEnvironment()): Date {
  return isMockE2EClockEnabled(environment) ? new Date(MOCK_E2E_CLOCK_ISO) : new Date();
}

export const mockE2EClock: Clock = { now: () => getMockNow() };

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

/**
 * Keep date-sensitive mock records meaningful relative to the frozen E2E day,
 * while retaining the historical values for ordinary local mock development.
 */
export function mockFixtureDate(daysFromNow: number, fallback: string): string {
  if (!isMockE2EClockEnabled()) return fallback;
  return addDays(new Date(MOCK_E2E_CLOCK_ISO), daysFromNow).toISOString().slice(0, 10);
}

function shanghaiDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function dateOnlyDay(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

export function daysOverdue(plannedEnd: string, now: Date = getMockNow()): number {
  const overdue = (Date.parse(shanghaiDate(now)) - dateOnlyDay(plannedEnd)) / 86_400_000;
  return Math.max(0, Math.floor(overdue));
}
