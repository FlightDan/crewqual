import { describe, expect, it } from "vitest";
import {
  evaluateQualification,
  evaluateStoredQualification,
  groupQualificationsByStatus,
} from "@/lib/qualification-date-status";
import { memberQualificationStatus, summarizeMemberQualifications } from "@/lib/member-health";

const clock = { now: () => new Date("2026-09-07T04:00:00Z") };
const timezone = "Asia/Shanghai";
const manual = { kind: "manual_expiry" };

describe("qualification domain status", () => {
  it("distinguishes absence, explicit non-expiring proof and incomplete expiring records", () => {
    expect(evaluateQualification({ record: null, timezone, clock })).toMatchObject({
      status: "missing",
      daysRemaining: null,
    });
    expect(
      evaluateQualification({
        record: { expiryDate: null, validityRule: { kind: "non_expiring" } },
        timezone,
        clock,
      }),
    ).toMatchObject({
      status: "valid",
      statusReason: "non_expiring",
      statusLabel: "长期有效",
      daysRemaining: null,
    });
    expect(
      evaluateQualification({
        record: { expiryDate: null, validityRule: manual },
        timezone,
        clock,
      }),
    ).toMatchObject({
      status: "incomplete",
      statusReason: "missing_expiry",
    });
  });

  it("does not treat an unverified or absent rule as non-expiring proof", () => {
    expect(
      evaluateQualification({
        record: {
          expiryDate: null,
          validityRule: { kind: "non_expiring" },
          snapshotSource: "inferred_backfill",
        },
        timezone,
        clock,
      }).status,
    ).toBe("incomplete");
    expect(
      evaluateStoredQualification(
        { expiryDate: null, qualificationRuleSnapshot: null },
        clock,
        timezone,
      ).status,
    ).toBe("incomplete");
    expect(
      evaluateQualification({
        record: { expiryDate: "2026-09-07", validityRule: manual },
        timezone: "invalid/timezone",
        clock,
      }).status,
    ).toBe("incomplete");
  });

  it.each([
    ["Asia/Shanghai", "2026-09-07T15:59:59Z", "due_30", 0],
    ["Asia/Shanghai", "2026-09-07T16:00:00Z", "expired", -1],
    ["UTC", "2026-09-07T23:59:59Z", "due_30", 0],
    ["UTC", "2026-09-08T00:00:00Z", "expired", -1],
    ["America/Los_Angeles", "2026-09-08T06:59:59Z", "due_30", 0],
    ["America/Los_Angeles", "2026-09-08T07:00:00Z", "expired", -1],
  ])("expires at the next midnight in %s (%s)", (zone, now, status, daysRemaining) => {
    expect(
      evaluateQualification({
        record: { expiryDate: new Date("2026-09-07T00:00:00Z"), validityRule: manual },
        timezone: zone,
        clock: { now: () => new Date(now) },
      }),
    ).toMatchObject({ status, daysRemaining });
  });

  it.each([
    ["2026-03-09", "2026-03-08T08:00:00Z"],
    ["2026-11-02", "2026-11-01T07:00:00Z"],
  ])("counts natural days across DST for %s", (expiryDate, now) => {
    expect(
      evaluateQualification({
        record: { expiryDate, validityRule: manual },
        timezone: "America/Los_Angeles",
        clock: { now: () => new Date(now) },
      }).daysRemaining,
    ).toBe(1);
  });

  it("marks inconsistent or invalid dates for human review", () => {
    for (const record of [
      { expiryDate: "2026-02-30", validityRule: manual },
      { expiryDate: "2026-09-07", validityRule: { kind: "non_expiring" } },
    ])
      expect(evaluateQualification({ record, timezone, clock }).status).toBe("incomplete");
  });

  it("keeps missing and incomplete items in portal sections", () => {
    const sections = groupQualificationsByStatus(
      [
        { id: "missing", name: "Missing", expiresOn: "", recordExists: false },
        {
          id: "incomplete",
          name: "Incomplete",
          expiresOn: "",
          validityRule: manual as { kind: "manual_expiry" },
        },
      ],
      clock,
    );
    expect(sections.find((item) => item.status === "missing")?.qualifications).toHaveLength(1);
    expect(sections.find((item) => item.status === "incomplete")?.qualifications).toHaveLength(1);
  });
});

describe("member qualification aggregation", () => {
  it("does not let optional alerts fail compliance or hide their item counts", () => {
    expect(
      summarizeMemberQualifications([
        { status: "valid", required: true },
        { status: "expired", required: false },
        { status: "missing", required: false },
      ]),
    ).toMatchObject({
      health: "valid",
      qualificationCounts: { expired: 1, missing: 1 },
      requiredQualificationCounts: { expired: 0, missing: 0 },
    });
  });
  it("separates no assignments from missing required records", () => {
    expect(summarizeMemberQualifications([]).health).toBe("unconfigured");
    expect(summarizeMemberQualifications([{ status: "missing", required: true }]).health).toBe(
      "missing",
    );
    expect(summarizeMemberQualifications([{ status: "incomplete", required: true }]).health).toBe(
      "incomplete",
    );
    expect(memberQualificationStatus("due_30")).toBe("due");
  });
});
