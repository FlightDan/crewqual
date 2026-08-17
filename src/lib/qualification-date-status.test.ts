import { describe, expect, it } from "vitest";
import { deriveQualificationDateState } from "@/lib/qualification-date-status";

const clock = { now: () => new Date("2026-08-14T15:30:00+08:00") };

describe("qualification expiry date derivation", () => {
  it.each([
    ["2026-08-13", "expired", "expired", -1, "已过期 1天"],
    ["2026-08-14", "due_30", "due_7", 0, "今日到期"],
    ["2026-08-21", "due_30", "due_7", 7, "剩余 7天"],
    ["2026-09-13", "due_30", "due_30", 30, "剩余 30天"],
    ["2026-11-12", "due_90", "due_90", 90, "剩余 90天"],
    ["2026-11-13", "valid", "valid", 91, "有效"],
  ] as const)(
    "derives %s across expiration boundaries",
    (expiresOn, status, window, daysRemaining, statusLabel) => {
      expect(deriveQualificationDateState(expiresOn, clock)).toMatchObject({
        status,
        window,
        daysRemaining,
        statusLabel,
      });
    },
  );

  it("uses calendar dates correctly across month boundaries", () => {
    expect(deriveQualificationDateState("2026-09-01", clock)).toMatchObject({
      daysRemaining: 18,
      status: "due_30",
      remainingLabel: "剩余 18 天",
    });
  });

  it("uses the Asia/Shanghai calendar boundary", () => {
    expect(
      deriveQualificationDateState("2026-08-14", {
        now: () => new Date("2026-08-14T15:59:59.000Z"),
      }),
    ).toMatchObject({ status: "due_30", daysRemaining: 0 });
    expect(
      deriveQualificationDateState("2026-08-14", {
        now: () => new Date("2026-08-14T16:00:00.000Z"),
      }),
    ).toMatchObject({ status: "expired", daysRemaining: -1 });
  });

  it("rejects impossible calendar dates instead of silently normalizing them", () => {
    expect(() => deriveQualificationDateState("2026-02-30", clock)).toThrow(
      /Invalid qualification expiry date/,
    );
  });
});
