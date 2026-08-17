import { describe, expect, it } from "vitest";
import {
  assertCoreQualificationsEligible,
  assertLifecycleAction,
  assertStageCanComplete,
  assertStageDates,
} from "@/server/upgrade-plan-rules";

const plan = { startDate: "2026-08-01", endDate: "2026-12-31" };
const stages = [
  { plannedStart: "2026-08-01", plannedEnd: "2026-08-15", status: "completed" as const },
  { plannedStart: "2026-08-16", plannedEnd: "2026-08-31", status: "scheduled" as const },
  { plannedStart: "2026-09-01", plannedEnd: "2026-09-15", status: "not_started" as const },
];

describe("upgrade plan server rules", () => {
  it("accepts only legal lifecycle transitions and requires a cancellation reason", () => {
    expect(() => assertLifecycleAction("draft", "start")).not.toThrow();
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
      { qualificationTypeId: "core-1", expiryDate: new Date("2027-01-01T00:00:00Z") },
      { qualificationTypeId: "core-2", expiryDate: null },
      { qualificationTypeId: "supplemental-expired", expiryDate: new Date("2020-01-01T00:00:00Z") },
    ];
    expect(() => assertCoreQualificationsEligible(core, valid)).not.toThrow();
    expect(() => assertCoreQualificationsEligible(core, valid.slice(0, 1))).toThrow("缺少核心资质");
    expect(() =>
      assertCoreQualificationsEligible(core, [
        valid[0]!,
        { qualificationTypeId: "core-2", expiryDate: new Date("2020-01-01T00:00:00Z") },
      ]),
    ).toThrow("核心资质已过期");
  });
});
