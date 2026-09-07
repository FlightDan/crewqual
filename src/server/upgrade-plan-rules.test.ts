import { describe, expect, it, vi } from "vitest";
import {
  assertCoreQualificationsEligible,
  assertLifecycleAction,
  assertStageCanComplete,
  assertStageDates,
  assertUpgradePlanEligibility,
  lockPositionAssignment,
  upgradePlanAssociationMode,
} from "@/server/upgrade-plan-rules";

const snapshot = (kind: "manual_expiry" | "non_expiring" = "manual_expiry") => ({
  snapshotSource: "captured",
  version: 1,
  validityRule: { kind },
  reminders: { firstDays: 90, secondDays: 30 },
  parameterRestriction: { enabled: false, description: "" },
  ocrChecks: {
    enabled: false,
    credentialNumber: false,
    holderMatch: false,
    expiryDate: false,
    issuingAuthoritySeal: false,
  },
});

const plan = { startDate: "2026-08-01", endDate: "2026-12-31" };
const stages = [
  { plannedStart: "2026-08-01", plannedEnd: "2026-08-15", status: "completed" as const },
  { plannedStart: "2026-08-16", plannedEnd: "2026-08-31", status: "scheduled" as const },
  { plannedStart: "2026-09-01", plannedEnd: "2026-09-15", status: "not_started" as const },
];

describe("upgrade plan server rules", () => {
  it("accepts only legal lifecycle transitions and requires a cancellation reason", () => {
    expect(() => assertLifecycleAction("draft", "start")).not.toThrow();
    expect(() => assertLifecycleAction("draft", "cancel", "任职已经结束")).not.toThrow();
    expect(() => assertLifecycleAction("completed", "pause")).toThrow("当前状态不可执行pause");
    expect(() => assertLifecycleAction("active", "cancel", "不取消")).toThrow(
      "取消原因至少需要 5 个字符",
    );
  });

  it("rejects stage overlap, out-of-range dates, and skipped completion", () => {
    expect(() => assertStageDates(plan, stages, 1, "2026-08-10", "2026-08-31")).toThrow(
      "前一固定顺序节点",
    );
    expect(() => assertStageDates(plan, stages, 1, "2026-08-16", "2027-01-01")).toThrow(
      "整体计划周期",
    );
    expect(() =>
      assertStageCanComplete("active", [stages[0]!, stages[2]!], 1, "2026-09-01", plan),
    ).toThrow("尚未进入可完成状态");
  });

  it("allows only the next scheduled node and blocks paused plans", () => {
    expect(() => assertStageCanComplete("active", stages, 1, "2026-08-20", plan)).not.toThrow();
    expect(() => assertStageCanComplete("paused", stages, 1, "2026-08-20", plan)).toThrow(
      "仅进行中的计划",
    );
  });

  it("ignores supplemental qualifications but blocks missing or expired core qualifications", () => {
    const core = [
      { id: "core-1", name: "核心一" },
      { id: "core-2", name: "核心二" },
    ];
    const valid = [
      {
        qualificationTypeId: "core-1",
        expiryDate: new Date("2027-01-01T00:00:00Z"),
        qualificationRuleSnapshot: snapshot(),
      },
      {
        qualificationTypeId: "core-2",
        expiryDate: null,
        qualificationRuleSnapshot: snapshot("non_expiring"),
      },
      {
        qualificationTypeId: "supplemental-expired",
        expiryDate: new Date("2020-01-01T00:00:00Z"),
        qualificationRuleSnapshot: snapshot(),
      },
    ];
    expect(() => assertCoreQualificationsEligible(core, valid)).not.toThrow();
    expect(() => assertCoreQualificationsEligible(core, valid.slice(0, 1))).toThrow("缺少核心资质");
    expect(() =>
      assertCoreQualificationsEligible(core, [
        valid[0]!,
        {
          qualificationTypeId: "core-2",
          expiryDate: new Date("2020-01-01T00:00:00Z"),
          qualificationRuleSnapshot: snapshot(),
        },
      ]),
    ).toThrow("核心资质已过期");
  });

  it("requires a linked position assignment to be active and effective today", async () => {
    const findUnique = vi.fn();
    const db = { personPositionAssignment: { findUnique } };
    const baseAssignment = {
      personId: "person-1",
      status: "ACTIVE",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      effectiveTo: new Date("2026-12-31T00:00:00.000Z"),
      position: { requirements: [] },
      person: {
        organizationId: "org-1",
        unitId: "unit-1",
        unit: { id: "unit-1", organizationId: "org-1", timezone: "Asia/Shanghai" },
      },
    };
    const plan = { personId: "person-1", positionAssignmentId: "assignment-1" };

    findUnique.mockResolvedValue({ ...baseAssignment, status: "ENDED" });
    await expect(
      assertUpgradePlanEligibility(db, plan, new Date("2026-09-04T00:00:00Z")),
    ).rejects.toThrow("不是 ACTIVE 状态");

    findUnique.mockResolvedValue({
      ...baseAssignment,
      effectiveFrom: new Date("2026-09-05T00:00:00.000Z"),
    });
    await expect(
      assertUpgradePlanEligibility(db, plan, new Date("2026-09-04T00:00:00Z")),
    ).rejects.toThrow("不在生效日期内");

    findUnique.mockResolvedValue({
      ...baseAssignment,
      effectiveTo: new Date("2026-09-03T00:00:00.000Z"),
    });
    await expect(
      assertUpgradePlanEligibility(db, plan, new Date("2026-09-04T00:00:00Z")),
    ).rejects.toThrow("不在生效日期内");

    findUnique.mockResolvedValue(baseAssignment);
    await expect(
      assertUpgradePlanEligibility(db, plan, new Date("2026-09-04T00:00:00Z")),
    ).resolves.toBeUndefined();
  });

  it("uses the shared database row-lock primitive for lifecycle races", async () => {
    const queryRaw = vi.fn().mockResolvedValue([]);
    await lockPositionAssignment({ $queryRaw: queryRaw }, "assignment-1");
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(queryRaw.mock.calls[0]![0]).toEqual(
      expect.arrayContaining([expect.stringContaining("FOR UPDATE")]),
    );
    expect(queryRaw.mock.calls[0]![1]).toBe("assignment-1");
  });

  it("rejects partially migrated plan associations instead of using legacy eligibility", async () => {
    expect(() =>
      upgradePlanAssociationMode({ personId: "person-1", positionAssignmentId: null }),
    ).toThrow("关联不完整");
    expect(() =>
      upgradePlanAssociationMode({ personId: null, positionAssignmentId: "assignment-1" }),
    ).toThrow("关联不完整");
    expect(upgradePlanAssociationMode({ personId: null, positionAssignmentId: null })).toBe(
      "legacy",
    );
  });
});

describe("qualification evidence and timezone eligibility", () => {
  const core = [{ id: "core", name: "核心" }];
  const now = new Date("2026-09-07T04:00:00Z");
  it("rejects missing expiry, missing snapshots and inferred backfills", () => {
    for (const qualificationRuleSnapshot of [
      null,
      snapshot(),
      { ...snapshot("non_expiring"), snapshotSource: "inferred_backfill" },
    ]) {
      expect(() =>
        assertCoreQualificationsEligible(
          core,
          [{ qualificationTypeId: "core", expiryDate: null, qualificationRuleSnapshot }],
          "Asia/Shanghai",
          now,
        ),
      ).toThrow("数据不完整");
    }
  });
  it("keeps expiry valid through the holder's final local day", () => {
    const records = [
      {
        qualificationTypeId: "core",
        expiryDate: new Date("2026-09-06T00:00:00Z"),
        qualificationRuleSnapshot: snapshot(),
      },
    ];
    expect(() =>
      assertCoreQualificationsEligible(core, records, "America/Los_Angeles", now),
    ).not.toThrow();
    expect(() => assertCoreQualificationsEligible(core, records, "Asia/Shanghai", now)).toThrow(
      "已过期",
    );
    expect(() => assertCoreQualificationsEligible(core, records, null, now)).toThrow("数据不完整");
  });
  it("selects and transmits the saved canonical snapshot", async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        qualificationDefinitionId: "core",
        expiryDate: null,
        qualificationRuleSnapshot: snapshot(),
      },
    ]);
    const db = {
      qualificationRecord: { findMany },
      personPositionAssignment: {
        findUnique: vi.fn().mockResolvedValue({
          personId: "person",
          status: "ACTIVE",
          effectiveFrom: new Date("2026-01-01Z"),
          effectiveTo: null,
          person: {
            organizationId: "org",
            unitId: "unit",
            unit: { id: "unit", organizationId: "org", timezone: "Asia/Shanghai" },
          },
          position: {
            requirements: [
              { qualificationDefinitionId: "core", qualificationDefinition: { name: "核心" } },
            ],
          },
        }),
      },
    };
    await expect(
      assertUpgradePlanEligibility(
        db,
        { personId: "person", positionAssignmentId: "assignment" },
        now,
      ),
    ).rejects.toThrow("数据不完整");
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: expect.objectContaining({ qualificationRuleSnapshot: true }),
      }),
    );
  });
});
