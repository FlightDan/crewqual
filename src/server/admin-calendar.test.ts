import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { dateOnlyForTimezone } from "@/lib/date-only";
import type { AuthenticatedAdmin } from "@/server/auth";

const mocks = vi.hoisted(() => ({ records: vi.fn(), types: vi.fn(), stages: vi.fn() }));
vi.mock("@/server/prisma", () => ({
  getPrisma: () => ({
    qualificationRecord: { findMany: mocks.records },
    qualificationType: { findMany: mocks.types },
    upgradeStage: { findMany: mocks.stages },
  }),
}));
vi.mock("@/server/admin-permissions", () => ({ requireAssignedUnit: () => "unit" }));
import {
  getAdminCalendarDayQualificationRoster,
  listAdminCalendarEvents,
  selectedDateClock,
} from "@/server/admin-calendar";

const admin = {} as AuthenticatedAdmin;
const type = {
  id: "type",
  code: "flight-license",
  name: "执照",
  validityRule: { kind: "manual_expiry" },
  translations: {},
};
const pilot = {
  id: "pilot",
  unitId: "unit",
  displayName: "甲",
  employeeNumber: "001",
  unit: { id: "unit", name: "一部", timezone: "America/Los_Angeles" },
};
const snapshot = {
  snapshotSource: "captured",
  version: 1,
  validityRule: { kind: "manual_expiry" },
  reminders: { firstDays: 90, secondDays: 30 },
  parameterRestriction: { enabled: false, description: "" },
  ocrChecks: {
    enabled: false,
    credentialNumber: false,
    holderMatch: false,
    expiryDate: false,
    issuingAuthoritySeal: false,
  },
};
const record = {
  id: "record",
  pilotId: "pilot",
  pilot,
  qualificationTypeId: "type",
  qualificationType: type,
  expiryDate: new Date("2026-09-06T00:00:00Z"),
  qualificationRuleSnapshot: snapshot,
};

describe("calendar qualification dates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-07T04:00:00Z"));
    vi.clearAllMocks();
    mocks.records.mockResolvedValue([record]);
    mocks.types.mockResolvedValue([type]);
    mocks.stages.mockResolvedValue([]);
  });
  afterEach(() => vi.useRealTimers());
  it.each(["America/Los_Angeles", "Pacific/Honolulu", "Pacific/Kiritimati", "Europe/Berlin"])(
    "projects selected dates into %s without changing the calendar day",
    (timezone) => {
      for (const date of ["2026-09-07", "2026-03-08", "2026-11-01"])
        expect(dateOnlyForTimezone(selectedDateClock(date, timezone).now(), timezone)).toBe(date);
    },
  );
  it("preserves DATE event values and evaluates the holder's current local date", async () => {
    const events = await listAdminCalendarEvents(admin, { from: "2026-09-06", to: "2026-09-06" });
    expect(events[0]).toMatchObject({
      date: "2026-09-06",
      endDate: "2026-09-06",
      status: "due_30",
      daysRemaining: 0,
    });
    expect(mocks.records.mock.calls[0][0].where.pilot).toEqual({ unitId: "unit" });
  });
  it("evaluates the selected roster day and retains missing core slots", async () => {
    mocks.types.mockResolvedValue([type, { ...type, id: "missing", code: "medical-certificate" }]);
    const result = await getAdminCalendarDayQualificationRoster(admin, { date: "2026-09-07" });
    expect(
      result.pilots[0].qualifications.find((slot) => slot.qualificationId === type.code)!.record,
    ).toMatchObject({ status: "expired", daysRemaining: -1 });
    expect(
      result.pilots[0].qualifications.find(
        (slot) => slot.qualificationId === "medical-certificate",
      )!.record,
    ).toBeNull();
  });
  it("retains incomplete records and flags conflicting owner mappings", async () => {
    mocks.records
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([{ ...record, expiryDate: null }]);
    const result = await getAdminCalendarDayQualificationRoster(admin, { date: "2026-09-07" });
    expect(result.pilots[0].qualifications[0].record).toMatchObject({
      status: "incomplete",
      daysRemaining: null,
    });
    mocks.records.mockResolvedValue([
      {
        ...record,
        pilot: {
          ...pilot,
          person: {
            organizationId: "org",
            unitId: "other",
            unit: { id: "other", organizationId: "org", timezone: "Asia/Shanghai" },
          },
        },
      },
    ]);
    expect((await listAdminCalendarEvents(admin, {}))[0]).toMatchObject({ status: "incomplete" });
  });
});
