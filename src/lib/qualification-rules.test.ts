import { describe, expect, it } from "vitest";
import {
  calculateExpectedExpiry,
  reminderWindow,
  validateQualificationRuleFields,
} from "@/lib/qualification-rules";

describe("qualification business rules", () => {
  it("calculates fixed-month expiry with end-of-month clamping", () => {
    expect(
      calculateExpectedExpiry(
        { issueDate: "2026-01-31" },
        { kind: "fixed_months", baseDateField: "issueDate", months: 1 },
      ),
    ).toBe("2026-02-28");
  });

  it("rejects a manually supplied expiry that violates a fixed-month rule", () => {
    const result = validateQualificationRuleFields(
      { issueDate: "2026-01-31", expiryDate: "2026-03-01" },
      { kind: "fixed_months", baseDateField: "issueDate", months: 1 },
    );
    expect(result.errors).toEqual([
      { field: "expiryDate", message: "按规则到期日期应为 2026-02-28" },
    ]);
  });

  it("normalizes a training-date fixed rule and clamps the month end", () => {
    expect(
      validateQualificationRuleFields(
        { issueDate: "2026-01-01", trainingDate: "2026-01-31", expiryDate: null },
        { kind: "fixed_months", baseDateField: "trainingDate", months: 1 },
      ),
    ).toEqual({ expiryDate: "2026-02-28", errors: [] });
  });

  it("normalizes non-expiring records to a null expiry", () => {
    expect(
      validateQualificationRuleFields(
        { issueDate: "2026-01-01", expiryDate: "" },
        { kind: "non_expiring" },
      ),
    ).toEqual({ expiryDate: null, errors: [] });
  });

  it("enforces versioned allowed values and treats legacy descriptions as help only", () => {
    const fields = {
      issueDate: "2026-01-01",
      expiryDate: "2027-01-01",
      levelOrParameter: "B737",
    };
    expect(
      validateQualificationRuleFields(
        fields,
        { kind: "manual_expiry" },
        {
          enabled: true,
          description: "请输入机型",
        },
      ).errors,
    ).toEqual([]);
    expect(
      validateQualificationRuleFields(
        fields,
        { kind: "manual_expiry" },
        {
          enabled: true,
          description: "仅允许批准机型",
          version: 1,
          enforcement: { mode: "allowed_values", allowedValues: ["A320"], pattern: "" },
        },
      ).errors,
    ).toContainEqual({ field: "levelOrParameter", message: "等级/参数必须是：A320" });
  });

  it("enforces a versioned regex parameter format", () => {
    const restriction = {
      enabled: true,
      description: "A320 等级",
      version: 1,
      enforcement: { mode: "regex", allowedValues: [], pattern: "^A320-(I|II)$" },
    };
    expect(
      validateQualificationRuleFields(
        {
          issueDate: "2026-01-01",
          expiryDate: "2027-01-01",
          levelOrParameter: "A320-III",
        },
        { kind: "manual_expiry" },
        restriction,
      ).errors,
    ).toContainEqual({ field: "levelOrParameter", message: "等级/参数格式不符合规则" });
  });

  it("uses the unit timezone and emits one configured reminder window", () => {
    const expiry = new Date("2026-08-20T00:00:00.000Z");
    const now = new Date("2026-08-15T16:00:00.000Z");
    expect(reminderWindow(expiry, now, { firstDays: 90, secondDays: 30 }, "Asia/Shanghai")).toEqual(
      { daysRemaining: 4, kind: "second" },
    );
  });
});
