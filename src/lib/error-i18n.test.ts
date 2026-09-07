import { describe, expect, it, vi } from "vitest";
import { localizeError } from "@/lib/error-i18n";

describe("localizeError", () => {
  it("maps stable service codes and preserves safe English messages", () => {
    const t = (key: string) =>
      ({
        "errors.notFound": "Not found",
        "errors.remote": "Service unavailable",
      })[key] ?? key;
    expect(localizeError(Object.assign(new Error("missing"), { code: "NOT_FOUND" }), t)).toBe(
      "Not found",
    );
    expect(localizeError(new Error("A safe message"), t)).toBe("A safe message");
  });

  it("falls back instead of exposing Chinese service text in English UI", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const t = (key: string) => (key === "errors.remote" ? "Service unavailable" : key);
    expect(localizeError(new Error("请求失败"), t)).toBe("Service unavailable");
    warn.mockRestore();
  });
  it("preserves actionable approval errors before generic conflict status", () => {
    const t = (key: string) => key;
    for (const [code, key] of [
      [
        "QUALIFICATION_BASELINE_REQUIRES_RESUBMISSION",
        "errors.QUALIFICATION_BASELINE_REQUIRES_RESUBMISSION",
      ],
      ["QUALIFICATION_CHANGED_SINCE_SUBMISSION", "errors.qualificationChanged"],
      ["QUALIFICATION_RULE_SNAPSHOT_REQUIRES_REVIEW", "errors.qualificationRuleReview"],
    ]) {
      expect(localizeError(Object.assign(new Error("Conflict"), { code, status: 409 }), t)).toBe(
        key,
      );
    }
  });
});
