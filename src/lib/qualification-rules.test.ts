import { afterEach, describe, expect, it, vi } from "vitest";
import {
  calculateExpectedExpiry,
  reminderWindow,
  validateQualificationRuleFields,
} from "@/lib/qualification-rules";

describe("qualification business rules", () => {
  afterEach(() => vi.unstubAllEnvs());

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

  it("rejects unsupported regex syntax at rule validation time", () => {
    const result = validateQualificationRuleFields(
      {
        issueDate: "2026-01-01",
        expiryDate: "2027-01-01",
        levelOrParameter: "aa",
      },
      { kind: "manual_expiry" },
      {
        enabled: true,
        description: "不支持的语法",
        version: 1,
        enforcement: { mode: "regex", allowedValues: [], pattern: "(?=a)a" },
      },
    );

    expect(result.errors).toContainEqual({
      field: "levelOrParameter",
      message: "等级/参数规则配置无效",
    });
  });

  it("defers regex matching to the API in a production browser", () => {
    vi.stubEnv("NODE_ENV", "production");
    const result = validateQualificationRuleFields(
      {
        issueDate: "2026-01-01",
        expiryDate: "2027-01-01",
        levelOrParameter: "A320-III",
      },
      { kind: "manual_expiry" },
      {
        enabled: true,
        description: "A320 等级",
        version: 1,
        enforcement: { mode: "regex", allowedValues: [], pattern: "^A320-(I|II)$" },
      },
    );

    expect(result.errors).not.toContainEqual(
      expect.objectContaining({ field: "levelOrParameter" }),
    );
  });

  it("uses the unit timezone and emits one configured reminder window", () => {
    const expiry = new Date("2026-08-20T00:00:00.000Z");
    const now = new Date("2026-08-15T16:00:00.000Z");
    expect(reminderWindow(expiry, now, { firstDays: 90, secondDays: 30 }, "Asia/Shanghai")).toEqual(
      { daysRemaining: 4, kind: "second" },
    );
  });
});

describe("reminder calendar boundaries", () => {
  it.each([
    ["America/Los_Angeles", "2026-08-21T06:59:59Z", 0, "today"],
    ["America/Los_Angeles", "2026-08-21T07:00:00Z", -1, "expired"],
    ["Asia/Shanghai", "2026-08-20T15:59:59Z", 0, "today"],
    ["Asia/Shanghai", "2026-08-20T16:00:00Z", -1, "expired"],
  ])("keeps DATE fixed in %s at %s", (zone, now, daysRemaining, kind) => {
    expect(reminderWindow(new Date("2026-08-20T00:00:00Z"), new Date(now), {}, zone)).toEqual({
      daysRemaining,
      kind,
    });
  });
  it("counts calendar days across DST rather than elapsed hours", () => {
    expect(
      reminderWindow(
        new Date("2026-03-09T00:00:00Z"),
        new Date("2026-03-08T07:30:00Z"),
        {},
        "America/New_York",
      ),
    ).toEqual({ daysRemaining: 1, kind: "second" });
  });
});
